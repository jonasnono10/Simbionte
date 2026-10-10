import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { businessProfileDigest, canonicalJson, normalizeBusinessProfileManifest } from "@/lib/simbionte/business-profiles/canonical";
import { BUSINESS_PROFILE_CATALOG, GENERIC_PROFILE } from "@/lib/simbionte/business-profiles/catalog";

import { authorityMigration, tamperedWires, wireDigest } from "../unit/simbionte/business-profiles/manifest-authority-fixtures";
import { sql } from "./gov-helpers";

const signature = "public.fn_business_profile_manifest_authorized(text,text,text)";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const authorized = (id: string, version: string, digest: string) =>
  sql(`select public.fn_business_profile_manifest_authorized(${quote(id)},${quote(version)},${quote(digest)});`);

describe("Business Profiles — autoridade oficial em PostgreSQL real (PG15/PG17)", () => {
  it.each(BUSINESS_PROFILE_CATALOG)("Node == PG == registry: $id $version", (profile) => {
    const canonical = canonicalJson(normalizeBusinessProfileManifest(profile));
    const expected = businessProfileDigest(profile);
    const pgDigest = sql(`select encode(extensions.digest(convert_to(${quote(canonical)}, 'UTF8'), 'sha256'), 'hex');`);
    expect(pgDigest).toBe(expected);
    expect(authorized(profile.id, profile.version, pgDigest)).toBe("t");
  });

  it.each(tamperedWires)("PostgreSQL rejeita bytes adulterados (%s)", (_name, wire) => {
    const pgDigest = sql(`select encode(extensions.digest(convert_to(${quote(wire)}, 'UTF8'), 'sha256'), 'hex');`);
    expect(pgDigest).toBe(wireDigest(wire));
    expect(authorized(GENERIC_PROFILE.id, GENERIC_PROFILE.version, pgDigest)).toBe("f");
  });

  it("false para identidade/versão/digest desconhecidos, cruzados ou null", () => {
    const digest = businessProfileDigest(GENERIC_PROFILE);
    const cases = [
      ["desconhecido", "1.0.0", digest], ["generico", "latest", digest],
      ["generico", "1.0.1", digest], ["generico", "1.0.0", "0".repeat(64)],
      ["salao-barbearia", "1.0.0", digest], ["generico", "1.0.0", digest.toUpperCase()],
    ] as const;
    for (const [id, version, candidate] of cases) expect(authorized(id, version, candidate)).toBe("f");
    expect(sql("select public.fn_business_profile_manifest_authorized(null,'1.0.0',null);")).toBe("f");
    expect(sql("select public.fn_business_profile_manifest_authorized('generico',null,null);")).toBe("f");
  });

  it("PUBLIC sem EXECUTE e owner postgres, nunca service_role", () => {
    expect(sql(`select pg_get_userbyid(proowner) || '|' || prosecdef::text || '|' || array_to_string(proconfig, ',') from pg_proc where oid=${quote(signature)}::regprocedure;`))
      .toBe("postgres|false|search_path=pg_catalog");
    expect(sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid=${quote(signature)}::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE';`)).toBe("0");
  });

  it.each(["anon", "authenticated", "service_role"])("%s sem privilégio efetivo nem chamada", (role) => {
    expect(sql(`select has_function_privilege(${quote(role)},${quote(signature)},'EXECUTE');`)).toBe("f");
    expect(() => sql(`set role ${role}; select public.fn_business_profile_manifest_authorized('generico','1.0.0','x');`))
      .toThrow(/permission denied for function fn_business_profile_manifest_authorized/);
  });

  it("migration, reaplicação e baseline equivalem e preservam dados", () => {
    const definition = () => sql(`select pg_get_functiondef(${quote(signature)}::regprocedure);`);
    const beforeDefinition = definition();
    const migration = readFileSync(path.resolve("supabase/migrations", authorityMigration), "utf8");
    const org = "d3100000-1111-4000-8000-000000000001";
    const digest = businessProfileDigest(GENERIC_PROFILE);
    sql(`insert into public.organizations(id,slug,legal_name,display_name) values ('${org}','digest-proof','Digest Proof','Digest Proof');
      insert into public.crm_pipelines(id,organization_id,name,slug) values ('d3100000-2222-4000-8000-000000000001','${org}','Funil preservado','digest-proof');
      insert into public.business_profile_installations(organization_id,profile_id,applied_version,manifest_digest,status,revision)
        values ('${org}','generico','1.0.0','${digest}','active',1);
      insert into public.business_profile_contributions(organization_id,profile_id,contribution_key,resource_kind,resource_ref,managed_value,managed_fingerprint,applied_version,state)
        values ('${org}','generico','pipeline.main','pipeline','d3100000-2222-4000-8000-000000000001','{"name":"Funil preservado"}','${digest}','1.0.0','managed');
      insert into public.business_profile_operations(organization_id,operation_type,idempotency_key,request_hash,profile_id,target_version,target_digest,manifest_snapshot,expected_revision,plan_hash)
        values ('${org}','install','digest-proof','${digest}','generico','1.0.0','${digest}','{}',0,'${digest}');`);
    const rows = () => sql(`select kind || '|' || value from (
      select 'crm' as kind,row_to_json(p)::text as value from public.crm_pipelines p where organization_id='${org}'
      union all select 'installation',row_to_json(i)::text from public.business_profile_installations i where organization_id='${org}'
      union all select 'contribution',row_to_json(c)::text from public.business_profile_contributions c where organization_id='${org}'
      union all select 'operation',row_to_json(o)::text from public.business_profile_operations o where organization_id='${org}'
    ) snapshots order by kind,value;`);
    const existing = rows();
    sql(`drop function ${signature};`);
    sql(migration);
    expect(definition()).toBe(beforeDefinition);
    sql(migration);
    expect(definition()).toBe(beforeDefinition);
    expect(rows()).toBe(existing);
    for (const profile of BUSINESS_PROFILE_CATALOG) expect(authorized(profile.id, profile.version, businessProfileDigest(profile))).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(sql(`select has_function_privilege(${quote(role)},${quote(signature)},'EXECUTE');`)).toBe("f");
    }
  });
});
