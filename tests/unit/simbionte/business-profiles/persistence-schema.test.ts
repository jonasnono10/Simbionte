import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../../..");
const migrationName = "20261003212120_0623_business_profile_persistence.sql";
const migration = readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8");
const baseline = readFileSync(path.join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(path.join(root, "supabase/migrations/MANIFEST.md"), "utf8");
const marker = "-- ---- memória e governança dos Business Profiles (migration 0623) ----";
const endMarker = "-- ---- fim da memória e governança dos Business Profiles (migration 0623) ----";

function normalized(sql: string): string {
  return sql.replace(/--[^\r\n]*/g, "").replace(/\s+/g, " ").trim();
}

describe("Business Profile — tripla de migration sem aplicador", () => {
  it("baseline e migration contêm o mesmo DDL efetivo", () => {
    const sections = baseline.split(marker);
    expect(sections).toHaveLength(2);
    const afterBlock = (sections[1] ?? "").split(endMarker);
    expect(afterBlock).toHaveLength(2);
    expect(normalized(afterBlock[0] ?? "")).toBe(normalized(migration));
    expect(migration).toMatch(/^-- manifest: .+/m);
    expect(manifest).not.toContain("business_profile_persistence");
  });

  it("cria só memória, sem função ou trigger que escreva no CRM", () => {
    expect(migration.match(/create table if not exists public\.business_profile_/g)).toHaveLength(3);
    expect(migration).not.toMatch(/\b(?:insert into|update|delete from)\s+public\.crm_/i);
    expect(migration).not.toMatch(/\b(?:http|net\.|emit_event|service_role handler)\b/i);
    expect(migration).toContain("resource_ref text");
    expect(migration).not.toContain("resource_ref uuid");
  });

  it("planner F2.3A continua sem dependência de banco, Auth ou API", () => {
    for (const name of ["canonical.ts", "catalog.ts", "manifest.ts", "planner.ts"]) {
      const source = readFileSync(path.join(root, "lib/simbionte/business-profiles", name), "utf8");
      expect(source).not.toMatch(/from ["'][^"']*(?:supabase|postgres|auth|api\/|env)/i);
    }
  });
});
