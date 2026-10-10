import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { businessProfileDigest } from "@/lib/simbionte/business-profiles/canonical";
import { BUSINESS_PROFILE_CATALOG, GENERIC_PROFILE } from "@/lib/simbionte/business-profiles/catalog";

import { authorityEnd, authorityMigration, authorityStart, officialWire, tamperedWires, wireDigest } from "./manifest-authority-fixtures";

const migration = readFileSync(path.resolve("supabase/migrations", authorityMigration), "utf8");
const baseline = readFileSync(path.resolve("supabase/baseline.sql"), "utf8");
const executable = migration.replace(/--[^\r\n]*/g, "");
const triples = [...executable.matchAll(/\('([^']+)', '([^']+)', '([a-f0-9]{64})'\)/g)]
  .map(([, id, version, digest]) => ({ id, version, digest }));

describe("Business Profiles — drift TS/registry e zero Apply", () => {
  it("cada versão executável tem autorização explícita no SQL, sem catálogo duplicado", () => {
    expect(triples).toHaveLength(BUSINESS_PROFILE_CATALOG.length);
    for (const profile of BUSINESS_PROFILE_CATALOG) {
      expect(triples).toContainEqual({ id: profile.id, version: profile.version, digest: businessProfileDigest(profile) });
    }
    expect(new Set(triples.map((entry) => `${entry.id}@${entry.version}`)).size).toBe(triples.length);
    expect(executable).not.toMatch(/\b(?:pipeline|stage|field|position|isDefault|jsonb|latest)\b/i);
  });

  it("baseline contém o mesmo bloco e migration tem um manifest, sem editar histórico", () => {
    expect(baseline.split(authorityStart)).toHaveLength(2);
    const block = baseline.slice(baseline.lastIndexOf(authorityStart) + authorityStart.length).split(authorityEnd);
    expect(block).toHaveLength(2);
    expect(block[0]?.trim()).toBe(migration.trim());
    expect(migration.match(/^-- manifest: .+$/gm)).toHaveLength(1);
    expect(readFileSync(path.resolve("supabase/migrations/MANIFEST.md"), "utf8")).not.toContain(authorityMigration);
  });

  it("ACL fechada, path seguro e nenhuma capability mutante", () => {
    expect(executable.match(/create or replace function /gi)).toHaveLength(1);
    expect(executable).toContain("security invoker");
    expect(executable).toContain("set search_path = pg_catalog");
    expect(executable).toMatch(/revoke execute on function public\.fn_business_profile_manifest_authorized\(text, text, text\)\s+from public, anon, authenticated, service_role;/);
    expect(executable).not.toMatch(/\b(?:insert|update|delete|upsert|merge|truncate|create table|security definer)\b/i);
    expect(executable).not.toMatch(/execute\s+(?:format|\$)/i);
  });

  it.each(tamperedWires)("conteúdo adulterado (%s) não coincide com digest oficial", (_name, wire) => {
    expect(wire).not.toBe(officialWire);
    expect(wireDigest(wire)).not.toBe(businessProfileDigest(GENERIC_PROFILE));
    expect(triples.some((entry) => entry.id === GENERIC_PROFILE.id && entry.version === GENERIC_PROFILE.version && entry.digest === wireDigest(wire))).toBe(false);
  });
});
