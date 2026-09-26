import { describe, expect, it } from "vitest";

import { businessProfileDigest, normalizeBusinessProfileManifest } from "@/lib/simbionte/business-profiles/canonical";
import { BUSINESS_PROFILE_CATALOG, GENERIC_PROFILE, SALON_PROFILE } from "@/lib/simbionte/business-profiles/catalog";
import {
  parseBusinessProfileManifest, UnsupportedProfileDomainError,
} from "@/lib/simbionte/business-profiles/manifest";

const clone = <T>(value: T): T => structuredClone(value);

describe("Business Profile manifests", () => {
  it("valida os dois perfis sem dados operacionais ou capacidade ativa", () => {
    expect(BUSINESS_PROFILE_CATALOG.map((item) => item.id)).toEqual(["generico", "salao-barbearia"]);
    for (const manifest of BUSINESS_PROFILE_CATALOG) {
      expect(parseBusinessProfileManifest(manifest)).toEqual(manifest);
      expect(manifest.contributions.filter((item) => item.kind === "pipeline")).toHaveLength(1);
      expect(manifest.contributions.filter((item) => item.kind === "stage" && item.step === "won")).toHaveLength(1);
      expect(manifest.contributions.filter((item) => item.kind === "stage" && item.step === "lost")).toHaveLength(1);
      expect(manifest.contributions.every((item) => ["pipeline", "stage", "field"].includes(item.kind))).toBe(true);
      expect(JSON.stringify(manifest)).not.toMatch(/contact_id|lead_id|conversation_id|customer_value|automation|agent_config/);
    }
    expect(GENERIC_PROFILE.contributions.filter((item) => item.kind === "field")).toHaveLength(0);
    const fields = SALON_PROFILE.contributions.filter((item) => item.kind === "field");
    expect(fields.map((item) => item.fieldKey)).toEqual(["servico_desejado", "profissional_preferido"]);
    expect(fields.every((item) => item.required === false)).toBe(true);
  });

  it("mantém identidade estável quando muda somente o nome visual", () => {
    const changed = clone(GENERIC_PROFILE);
    changed.contributions.find((item) => item.kind === "pipeline")!.name = "Pessoas";
    expect(changed.contributions.map((item) => item.key)).toEqual(GENERIC_PROFILE.contributions.map((item) => item.key));
    expect(businessProfileDigest(changed)).not.toBe(businessProfileDigest(GENERIC_PROFILE));
  });

  it("rejeita formato, versão e id inválidos", () => {
    expect(() => parseBusinessProfileManifest({ ...GENERIC_PROFILE, formatVersion: 2 })).toThrow();
    expect(() => parseBusinessProfileManifest({ ...GENERIC_PROFILE, version: "v1" })).toThrow();
    expect(() => parseBusinessProfileManifest({ ...GENERIC_PROFILE, id: "Genérico!" })).toThrow();
  });

  it("rejeita duplicatas, pai ausente, won/lost ausentes e campo duplicado", () => {
    const duplicate = clone(GENERIC_PROFILE);
    duplicate.contributions.push(clone(duplicate.contributions[1]!));
    expect(() => parseBusinessProfileManifest(duplicate)).toThrow(/duplicada/);

    const orphan = clone(GENERIC_PROFILE);
    orphan.contributions.find((item) => item.kind === "stage")!.pipelineKey = "pipeline.inexistente";
    expect(() => parseBusinessProfileManifest(orphan)).toThrow(/pai inexistente/);

    const noWon = clone(GENERIC_PROFILE);
    noWon.contributions = noWon.contributions.filter((item) => item.kind !== "stage" || item.step !== "won");
    expect(() => parseBusinessProfileManifest(noWon)).toThrow(/won ausente/);

    const noLost = clone(GENERIC_PROFILE);
    noLost.contributions = noLost.contributions.filter((item) => item.kind !== "stage" || item.step !== "lost");
    expect(() => parseBusinessProfileManifest(noLost)).toThrow(/lost ausente/);

    const duplicateField = clone(SALON_PROFILE);
    const field = duplicateField.contributions.find((item) => item.kind === "field")!;
    duplicateField.contributions.push({ ...field, key: "field.main.outra_chave" });
    expect(() => parseBusinessProfileManifest(duplicateField)).toThrow(/Campo duplicado/);
  });

  it("bloqueia agente, automação, efeito externo e expansão de autoridade", () => {
    for (const [kind, classification] of [
      ["agent", "EXTERNAL_EFFECT"], ["automation", "EXTERNAL_EFFECT"],
      ["message", "EXTERNAL_EFFECT"], ["autonomy", "PRIVILEGE_EXPANSION"],
      ["permission", "PRIVILEGE_EXPANSION"],
    ] as const) {
      const candidate = { ...GENERIC_PROFILE, contributions: [...GENERIC_PROFILE.contributions, { kind }] };
      expect(() => parseBusinessProfileManifest(candidate)).toThrow(UnsupportedProfileDomainError);
      try { parseBusinessProfileManifest(candidate); } catch (error) {
        expect((error as UnsupportedProfileDomainError).classification).toBe(classification);
      }
    }
    expect(() => parseBusinessProfileManifest({
      ...GENERIC_PROFILE, contributions: [...GENERIC_PROFILE.contributions, { kind: "knowledge" }],
    })).toThrow();
  });
});

describe("canonicalização", () => {
  it("ignora ordem de propriedades, ordem das contribuições e whitespace visual", () => {
    const scrambled = {
      contributions: [...GENERIC_PROFILE.contributions].reverse().map((item) => ({ ...item })),
      compatibility: { profileApi: { max: 1, min: 1 } },
      description: `  ${GENERIC_PROFILE.description.replaceAll(" ", "  ")}  `,
      displayName: ` ${GENERIC_PROFILE.displayName} `,
      version: GENERIC_PROFILE.version,
      id: GENERIC_PROFILE.id,
      formatVersion: 1,
    };
    expect(normalizeBusinessProfileManifest(scrambled).contributions.map((item) => item.kind)[0]).toBe("pipeline");
    expect(businessProfileDigest(scrambled)).toBe(businessProfileDigest(GENERIC_PROFILE));
    expect(businessProfileDigest(GENERIC_PROFILE)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("muda com conteúdo semanticamente relevante", () => {
    expect(businessProfileDigest({ ...GENERIC_PROFILE, version: "1.0.1" })).not.toBe(businessProfileDigest(GENERIC_PROFILE));
  });
});
