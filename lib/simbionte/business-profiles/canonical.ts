import { createHash } from "node:crypto";

import { parseBusinessProfileManifest, type BusinessProfileManifest, type ResourceKind } from "./manifest";

export const RESOURCE_ORDER: Record<ResourceKind, number> = { pipeline: 0, stage: 1, field: 2 };
export const compareKeys = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** JSON sem dependência da ordem de propriedades; arrays preservam sua ordem semântica. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("Valor não canônico no perfil");
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** A coleção de contribuições é um conjunto ordenado por dependência e identidade. */
export function normalizeBusinessProfileManifest(input: unknown): BusinessProfileManifest {
  const manifest = parseBusinessProfileManifest(input);
  return {
    ...manifest,
    contributions: [...manifest.contributions].sort(
      (a, b) => RESOURCE_ORDER[a.kind] - RESOURCE_ORDER[b.kind] || compareKeys(a.key, b.key),
    ),
  };
}

export function businessProfileDigest(input: unknown): string {
  return sha256Canonical(normalizeBusinessProfileManifest(input));
}
