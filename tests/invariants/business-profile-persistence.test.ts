import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

const A = "b2300000-0000-4000-8000-000000000001";
const B = "b2300000-0000-4000-8000-000000000002";
const VIEWER = "b2300000-1111-4000-8000-000000000001";
const AGENT = "b2300000-1111-4000-8000-000000000002";
const MANAGER = "b2300000-1111-4000-8000-000000000003";
const ADMIN = "b2300000-1111-4000-8000-000000000004";
const OTHER = "b2300000-1111-4000-8000-000000000005";
const PLATFORM = "b2300000-1111-4000-8000-000000000006";
const INVITED = "b2300000-1111-4000-8000-000000000007";
const SUPPORT_FULL = "b2300000-6666-4000-8000-000000000001";
const SUPPORT_READONLY = "b2300000-6666-4000-8000-000000000002";
const OP = "b2300000-2222-4000-8000-000000000001";
const HASH = "a".repeat(64);
const DIGEST = "b".repeat(64);
const PLAN = "c".repeat(64);

function errorOf(script: string): string {
  try {
    sql(script);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error("SQL deveria ter sido recusado");
}

function operation(id: string, org: string, key: string, hash = HASH): string {
  return `insert into public.business_profile_operations
    (id, organization_id, operation_type, idempotency_key, request_hash,
     profile_id, target_version, target_digest, manifest_snapshot,
     expected_revision, plan_hash)
    values ('${id}', '${org}', 'install', '${key}', '${hash}',
      'salao', '1.0.0', '${DIGEST}', '{"id":"salao","version":"1.0.0"}'::jsonb, 0, '${PLAN}')`;
}

beforeAll(() => {
  sql(`
    insert into auth.users(id, email) values
      ('${VIEWER}', 'bp-viewer@invariant.test'),
      ('${AGENT}', 'bp-agent@invariant.test'),
      ('${MANAGER}', 'bp-manager@invariant.test'),
      ('${ADMIN}', 'bp-admin@invariant.test'),
      ('${OTHER}', 'bp-other@invariant.test'),
      ('${PLATFORM}', 'bp-platform@invariant.test'),
      ('${INVITED}', 'bp-invited@invariant.test');
    insert into public.organizations(id, slug, legal_name, display_name) values
      ('${A}', 'bp-invariant-a', 'Business Profile A', 'Business Profile A'),
      ('${B}', 'bp-invariant-b', 'Business Profile B', 'Business Profile B');
    insert into public.user_organizations(user_id, organization_id, role, accepted_at) values
      ('${VIEWER}', '${A}', 'viewer', now()),
      ('${AGENT}', '${A}', 'agent', now()),
      ('${MANAGER}', '${A}', 'manager', now()),
      ('${ADMIN}', '${A}', 'admin', now()),
      ('${OTHER}', '${B}', 'manager', now()),
      ('${INVITED}', '${A}', 'manager', null);
    insert into public.platform_admins(user_id, granted_by, scope, reason, mfa_required)
      values ('${PLATFORM}', '${PLATFORM}', 'full', 'invariant fixture', false);
    insert into auth.sessions(id, user_id, aal) values
      ('${SUPPORT_FULL}', '${PLATFORM}', 'aal1'),
      ('${SUPPORT_READONLY}', '${PLATFORM}', 'aal1');
    insert into public.platform_support_sessions
      (organization_id, actor_user_id, auth_session_id, access_mode, expires_at)
      values
      ('${A}', '${PLATFORM}', '${SUPPORT_FULL}', 'full', now() + interval '1 hour'),
      ('${A}', '${PLATFORM}', '${SUPPORT_READONLY}', 'support_readonly', now() + interval '1 hour');
    insert into public.crm_pipelines(id, organization_id, name, slug)
      values ('b2300000-3333-4000-8000-000000000001', '${A}', 'Pipeline preexistente', 'bp-existing');
    insert into public.crm_stages(id, organization_id, pipeline_id, name, slug, position)
      values ('b2300000-3333-4000-8000-000000000002', '${A}',
        'b2300000-3333-4000-8000-000000000001', 'Etapa preexistente', 'bp-existing', 1);
    insert into public.business_profile_installations
      (organization_id, profile_id, applied_version, manifest_digest, status, revision)
      values ('${A}', 'salao', '1.0.0', '${DIGEST}', 'active', 1),
             ('${B}', 'salao', '1.0.0', '${DIGEST}', 'disabled', 1);
    insert into public.business_profile_contributions
      (organization_id, profile_id, contribution_key, resource_kind, resource_ref,
       managed_value, managed_fingerprint, applied_version, state)
      values ('${A}', 'salao', 'pipeline.principal', 'pipeline',
        'config:pipeline:principal', '{"name":"Atendimento","isDefault":false}'::jsonb,
        '${HASH}', '1.0.0', 'managed');
    ${operation(OP, A, "initial")};
  `);
});

describe("Business Profile — memória sem aplicador", () => {
  it("três tabelas têm RLS e só política SELECT", () => {
    expect(sql(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in
        ('business_profile_installations','business_profile_contributions','business_profile_operations')
        and c.relkind='r' and c.relrowsecurity;`)).toBe("3");
    expect(sql(`select count(*) from pg_policies where schemaname='public'
      and tablename like 'business_profile_%' and cmd <> 'SELECT';`)).toBe("0");
  });

  it("manager/admin aceitos leem; viewer/agent/convite pendente/platform não; tenant B não vaza", () => {
    for (const table of ["installations", "contributions", "operations"]) {
      const source = `public.business_profile_${table}`;
      expect(countAs(MANAGER, `select count(*) from ${source} where organization_id='${A}';`)).toBe(1);
      expect(countAs(ADMIN, `select count(*) from ${source} where organization_id='${A}';`)).toBe(1);
      expect(countAs(VIEWER, `select count(*) from ${source};`)).toBe(0);
      expect(countAs(AGENT, `select count(*) from ${source};`)).toBe(0);
      expect(countAs(OTHER, `select count(*) from ${source} where organization_id='${A}';`)).toBe(0);
      expect(countAs(PLATFORM, `select count(*) from ${source};`)).toBe(0);
      expect(countAs(INVITED, `select count(*) from ${source};`)).toBe(0);
    }
  });

  it("suporte full usa admin canônico; suporte read-only não ganha leitura manager", () => {
    for (const table of ["installations", "contributions", "operations"]) {
      const source = `public.business_profile_${table}`;
      const asSupport = (session: string) => {
        const out = sql(`set role authenticated;
          select set_config('request.jwt.claims',
            '{"sub":"${PLATFORM}","session_id":"${session}","aal":"aal1"}', false);
          select count(*) from ${source} where organization_id='${A}';`);
        return Number(out.split("\n").at(-1));
      };
      expect(asSupport(SUPPORT_FULL)).toBe(1);
      expect(asSupport(SUPPORT_READONLY)).toBe(0);
    }
  });

  it("cliente e service_role não têm escrita direta", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["installations", "contributions", "operations"]) {
        expect(sql(`select has_table_privilege('${role}',
          'public.business_profile_${table}', 'INSERT,UPDATE,DELETE,TRUNCATE');`)).toBe("f");
      }
    }
    expect(errorOf(`set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MANAGER}"}', false);
      update public.business_profile_installations set status='disabled'
        where organization_id='${A}';`)).toContain("permission denied");
  });

  it("instalação única, revision monotônica, status e digest válidos", () => {
    expect(errorOf(`insert into public.business_profile_installations
      (organization_id, profile_id, applied_version, manifest_digest, status, revision)
      values ('${A}', 'salao', '1.0.0', '${DIGEST}', 'active', 1);`)).toContain("duplicate key");
    expect(errorOf(`update public.business_profile_installations
      set status='disabled' where organization_id='${A}';`))
      .toContain("business_profile_revision_not_monotonic");
    expect(errorOf(`update public.business_profile_installations
      set revision=0 where organization_id='${A}';`))
      .toContain("business_profile_revision_not_monotonic");
    for (const mutation of ["status='unknown'", "manifest_digest='bad'"]) {
      expect(errorOf(`update public.business_profile_installations set ${mutation}, revision=2
        where organization_id='${A}';`)).toContain("check constraint");
    }
    sql(`update public.business_profile_installations
      set status='disabled', revision=2 where organization_id='${A}';`);
    expect(sql(`select status || '|' || revision from public.business_profile_installations
      where organization_id='${A}';`)).toBe("disabled|2");
  });

  it("BASE preservada; resource_ref não UUID aceita e vazio/JSON inválido recusam", () => {
    const value = sql(`select managed_value::text from public.business_profile_contributions
      where organization_id='${A}' and contribution_key='pipeline.principal';`);
    expect(JSON.parse(value)).toEqual({ name: "Atendimento", isDefault: false });
    expect(sql(`select resource_ref from public.business_profile_contributions
      where organization_id='${A}' and contribution_key='pipeline.principal';`))
      .toBe("config:pipeline:principal");
    for (const mutation of ["resource_ref='   '", "managed_fingerprint='bad'", "managed_value='[]'::jsonb", "state='unknown'"]) {
      expect(errorOf(`update public.business_profile_contributions set ${mutation}
        where organization_id='${A}';`)).toContain("check constraint");
    }
  });

  it("contribution_key não duplica e pai não cruza tenant", () => {
    expect(errorOf(`insert into public.business_profile_contributions
      (organization_id, profile_id, contribution_key, resource_kind, resource_ref,
       managed_value, managed_fingerprint, applied_version, state)
      values ('${A}', 'salao', 'pipeline.principal', 'pipeline', 'outra-ref',
        '{}'::jsonb, '${HASH}', '1.0.0', 'managed');`)).toContain("duplicate key");
    expect(errorOf(`insert into public.business_profile_contributions
      (organization_id, profile_id, contribution_key, resource_kind, resource_ref,
       managed_value, managed_fingerprint, applied_version, state)
      values ('${A}', 'salao', 'stage.principal.nova', 'stage', 'stage:nova',
        '{}'::jsonb, '${HASH}', '1.0.0', 'managed');`)).toContain("check constraint");
    expect(errorOf(`insert into public.business_profile_contributions
      (organization_id, profile_id, contribution_key, resource_kind, resource_ref,
       parent_contribution_key, managed_value, managed_fingerprint, applied_version, state)
      values ('${B}', 'salao', 'stage.principal.nova', 'stage', 'stage:nova',
        'pipeline.principal', '{}'::jsonb, '${HASH}', '1.0.0', 'managed');`)).toContain("foreign key");
  });

  it("operação recusa status, hash e snapshot de tipo inválidos", () => {
    expect(errorOf(`update public.business_profile_operations
      set status='applying' where id='${OP}';`)).toContain("check constraint");
    expect(errorOf(`${operation("b2300000-2222-4000-8000-000000000006", A, "bad-hash", "bad")};`))
      .toContain("check constraint");
    expect(errorOf(`${operation("b2300000-2222-4000-8000-000000000008", A, "bad-digest")
      .replace(`'${DIGEST}'`, "'bad'")};`)).toContain("check constraint");
    expect(errorOf(`${operation("b2300000-2222-4000-8000-000000000007", A, "bad-snapshot")
      .replace('{"id":"salao","version":"1.0.0"}', '[]')};`)).toContain("check constraint");
  });

  it("idempotency_key é única por org; hash diferente conflita", () => {
    expect(sql(`select id from public.business_profile_operations where
      organization_id='${A}' and idempotency_key='initial' and request_hash='${HASH}';`)).toBe(OP);
    expect(errorOf(`${operation("b2300000-2222-4000-8000-000000000003", A, "initial", "d".repeat(64))};`))
      .toContain("duplicate key");
    sql(`${operation("b2300000-2222-4000-8000-000000000004", B, "initial")};`);
    expect(sql("select count(*) from public.business_profile_operations where idempotency_key='initial';"))
      .toBe("2");
  });

  it("snapshot prepared e recibo terminal são imutáveis", () => {
    expect(errorOf(`update public.business_profile_operations
      set manifest_snapshot='{"id":"outro"}'::jsonb where id='${OP}';`))
      .toContain("business_profile_request_immutable");
    expect(errorOf(`update public.business_profile_operations
      set status='completed' where id='${OP}';`)).toContain("check constraint");
    sql(`update public.business_profile_operations set status='completed',
      result='{"applied":false}'::jsonb, finished_at=now(), updated_at=now()
      where id='${OP}';`);
    expect(errorOf(`update public.business_profile_operations
      set status='failed' where id='${OP}';`)).toContain("business_profile_terminal_immutable");
    expect(errorOf(`update public.business_profile_operations
      set result='{"applied":true}'::jsonb where id='${OP}';`))
      .toContain("business_profile_terminal_immutable");
  });

  it("sem FK ou trigger sobre CRM e pipeline/stage existentes intactos", () => {
    expect(sql(`select count(*) from pg_constraint k
      join pg_class c on c.oid=k.conrelid join pg_class target on target.oid=k.confrelid
      where c.relname like 'business_profile_%' and target.relname like 'crm_%';`)).toBe("0");
    expect(sql(`select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where c.relname like 'crm_%' and not t.tgisinternal
        and t.tgname like 'trg_business_profile_%';`)).toBe("0");
    expect(sql("select name || '|' || slug from public.crm_pipelines where id='b2300000-3333-4000-8000-000000000001';"))
      .toBe("Pipeline preexistente|bp-existing");
    expect(sql("select name || '|' || slug from public.crm_stages where id='b2300000-3333-4000-8000-000000000002';"))
      .toBe("Etapa preexistente|bp-existing");
  });

  it("remoção de organização limpa a memória, inclusive recibo terminal", () => {
    const org = "b2300000-0000-4000-8000-000000000003";
    const op = "b2300000-2222-4000-8000-000000000005";
    sql(`insert into public.organizations(id, slug, legal_name, display_name)
      values ('${org}', 'bp-cascade', 'BP Cascade', 'BP Cascade');
      insert into public.business_profile_installations
        (organization_id, profile_id, applied_version, manifest_digest, status, revision)
        values ('${org}', 'salao', '1.0.0', '${DIGEST}', 'disabled', 1);
      ${operation(op, org, "cascade")};
      update public.business_profile_operations
        set status='cancelled', result='{}'::jsonb, finished_at=now(), updated_at=now()
        where id='${op}';
      delete from public.organizations where id='${org}';`);
    expect(sql(`select count(*) from public.business_profile_installations where organization_id='${org}';`)).toBe("0");
    expect(sql(`select count(*) from public.business_profile_operations where organization_id='${org}';`)).toBe("0");
  });

  it("migration reaplica sobre dados existentes", () => {
    const migration = readFileSync(
      path.resolve("supabase/migrations/20261003212120_0623_business_profile_persistence.sql"),
      "utf8",
    );
    sql(migration);
    expect(sql(`select count(*) from public.business_profile_installations where organization_id='${A}';`)).toBe("1");
    expect(sql(`select count(*) from public.business_profile_contributions where organization_id='${A}';`)).toBe("1");
  });
});
