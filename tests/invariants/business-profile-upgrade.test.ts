import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER ausente — rode via pnpm test:db");
const containerName: string = container;

function schemaDump(): string {
  const dump = execFileSync(
    "docker",
    ["exec", containerName, "pg_dump", "-U", "postgres", "-d", "postgres",
      "--schema-only", "--no-owner",
      "-t", "public.business_profile_installations",
      "-t", "public.business_profile_contributions",
      "-t", "public.business_profile_operations"],
    { encoding: "utf8" },
  );
  // PostgreSQL 17+ emits a fresh random psql restriction key per dump.
  return dump.replace(/^\\(?:un)?restrict\s+\S+\r?\n/gm, "");
}

function functionBodies(): string {
  return sql(`
    select pg_get_functiondef('public.fn_business_profile_installation_revision()'::regprocedure)
      || pg_get_functiondef('public.fn_business_profile_operation_immutable()'::regprocedure);
  `);
}

describe("Business Profile — upgrade real da versão anterior", () => {
  it("migration sobre estado anterior equivale ao baseline novo e preserva CRM", () => {
    // Cada arquivo de invariantes recebe banco descartável próprio, copiado do baseline.
    const freshTables = schemaDump();
    const freshFunctions = functionBodies();
    const org = "b2300000-4444-4000-8000-000000000001";
    const pipeline = "b2300000-5555-4000-8000-000000000001";
    sql(`
      insert into public.organizations(id, slug, legal_name, display_name)
        values ('${org}', 'bp-upgrade', 'BP Upgrade', 'BP Upgrade');
      insert into public.crm_pipelines(id, organization_id, name, slug)
        values ('${pipeline}', '${org}', 'Funil existente', 'bp-upgrade');
      drop table public.business_profile_contributions;
      drop table public.business_profile_operations;
      drop table public.business_profile_installations;
      drop function public.fn_business_profile_installation_revision();
      drop function public.fn_business_profile_operation_immutable();
    `);
    expect(sql("select count(*) from pg_class where relname like 'business_profile_%' and relkind='r';"))
      .toBe("0");
    const migration = readFileSync(
      path.resolve("supabase/migrations/20261003212120_0623_business_profile_persistence.sql"),
      "utf8",
    );
    sql(migration);
    expect(schemaDump()).toBe(freshTables);
    expect(functionBodies()).toBe(freshFunctions);
    expect(sql(`select name || '|' || slug from public.crm_pipelines where id='${pipeline}';`))
      .toBe("Funil existente|bp-upgrade");
  });
});
