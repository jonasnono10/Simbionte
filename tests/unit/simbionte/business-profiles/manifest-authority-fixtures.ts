import { createHash } from "node:crypto";

import { canonicalJson, normalizeBusinessProfileManifest } from "@/lib/simbionte/business-profiles/canonical";
import { GENERIC_PROFILE } from "@/lib/simbionte/business-profiles/catalog";

export const authorityMigration = "20261010020447_0627_business_profile_manifest_authority.sql";
export const authorityStart = "-- ---- Digests oficiais de Business Profiles (migration 0627) ----";
export const authorityEnd = "-- ---- Fim dos digests oficiais de Business Profiles (migration 0627) ----";

/** Bytes recebidos, sem reparar formato nem reconstruir JSON. */
export const wireDigest = (wire: string) => createHash("sha256").update(wire, "utf8").digest("hex");
const target = normalizeBusinessProfileManifest(GENERIC_PROFILE);
export const officialWire = canonicalJson(target);
export const tamperedWires = [
  ["nome", officialWire.replace('"displayName":"Genérico"', '"displayName":"Outro"')],
  ["versão", officialWire.replace('"version":"1.0.0"', '"version":"1.0.1"')],
  ["profile_id", officialWire.replace('"id":"generico"', '"id":"outro"')],
  ["stage", officialWire.replace('"name":"Novo contato"', '"name":"Etapa adulterada"')],
  ["step", officialWire.replace('"step":"new"', '"step":"contacted"')],
  ["position", officialWire.replace('"position":1', '"position":8')],
  ["isDefault", officialWire.replace('"isDefault":false', '"isDefault":true')],
  ["contribuição extra", canonicalJson({ ...target, contributions: [...target.contributions,
    { kind: "field", key: "field.main.extra", pipelineKey: "pipeline.main", fieldKey: "extra", label: "Extra", type: "text", required: false }] })],
  ["espaço no wire", ` ${officialWire}`],
  ["newline no wire", `${officialWire}\n`],
  ["ordem textual", JSON.stringify(Object.fromEntries(Object.entries(target).reverse()))],
] as const;
