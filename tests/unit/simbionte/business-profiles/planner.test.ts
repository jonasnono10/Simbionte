import { describe, expect, it } from "vitest";

import { GENERIC_PROFILE, SALON_PROFILE } from "@/lib/simbionte/business-profiles/catalog";
import type { BusinessProfileManifest, ProfileContribution } from "@/lib/simbionte/business-profiles/manifest";
import {
  planBusinessProfileChanges, type AppliedProfileBase, type ProfileResourceSnapshot,
} from "@/lib/simbionte/business-profiles/planner";

function row(item: ProfileContribution): ProfileResourceSnapshot {
  switch (item.kind) {
    case "pipeline": return {
      contributionKey: item.key, resourceKind: "pipeline", resourceId: "pipeline-1", parentKey: null,
      value: { name: item.name, isDefault: false },
    };
    case "stage": return {
      contributionKey: item.key, resourceKind: "stage", resourceId: `stage-${item.step}`,
      parentKey: item.pipelineKey,
      value: { name: item.name, step: item.step, position: item.position, isWon: item.step === "won", isLost: item.step === "lost" },
    };
    case "field": return {
      contributionKey: item.key, resourceKind: "field", resourceId: `field-${item.fieldKey}`,
      parentKey: item.pipelineKey,
      value: { fieldKey: item.fieldKey, label: item.label, type: item.type, required: false },
    };
  }
}

const rows = (manifest: BusinessProfileManifest) => manifest.contributions.map(row);
const applied = (manifest: BusinessProfileManifest): AppliedProfileBase => ({
  profileId: manifest.id, version: manifest.version, contributions: rows(manifest),
});
const clone = <T>(value: T): T => structuredClone(value);
const pick = (plan: ReturnType<typeof planBusinessProfileChanges>, key: string) =>
  plan.changes.find((change) => change.contributionKey === key)!;

describe("planejador three-way", () => {
  it("propõe adições na ordem pipeline → etapas → campos", () => {
    const plan = planBusinessProfileChanges({ base: null, local: [], target: SALON_PROFILE });
    expect(plan.changes.map((item) => item.resourceKind)).toEqual([
      "pipeline", ...Array(7).fill("stage"), "field", "field",
    ]);
    expect(plan.changes.every((item) => item.classification === "SAFE_ADD" && !item.blocked)).toBe(true);
    expect(plan.fromVersion).toBeNull();
  });

  it("reconhece UNCHANGED e SAFE_METADATA quando BASE=LOCAL", () => {
    const base = applied(GENERIC_PROFILE);
    const unchanged = planBusinessProfileChanges({ base, local: rows(GENERIC_PROFILE), target: GENERIC_PROFILE });
    expect(unchanged.changes.every((item) => item.classification === "UNCHANGED")).toBe(true);

    const target = clone(GENERIC_PROFILE);
    target.version = "1.1.0";
    const pipeline = target.contributions.find((item) => item.kind === "pipeline")!;
    pipeline.name = "Relacionamentos";
    const changed = planBusinessProfileChanges({ base, local: rows(GENERIC_PROFILE), target });
    expect(pick(changed, "pipeline.main").classification).toBe("SAFE_METADATA");
    expect(pick(changed, "pipeline.main").decisionRequired).toBe(true);
  });

  it("preserva drift quando TARGET=BASE e bloqueia divergência tripla", () => {
    const base = applied(GENERIC_PROFILE);
    const local = rows(GENERIC_PROFILE);
    const pipeline = local.find((item) => item.resourceKind === "pipeline")!;
    pipeline.value.name = "Meu quadro";
    const drift = planBusinessProfileChanges({ base, local, target: GENERIC_PROFILE });
    expect(pick(drift, "pipeline.main").classification).toBe("LOCAL_DRIFT");
    expect(pick(drift, "pipeline.main").local).toEqual({ name: "Meu quadro", isDefault: false });

    const target = clone(GENERIC_PROFILE);
    target.version = "1.1.0";
    target.contributions.find((item) => item.kind === "pipeline")!.name = "Novo nome do perfil";
    const conflict = planBusinessProfileChanges({ base, local, target });
    expect(pick(conflict, "pipeline.main").classification).toBe("CONFLICT");
    expect(pick(conflict, "pipeline.main").blocked).toBe(true);
  });

  it("não reassume gestão quando LOCAL=TARGET≠BASE", () => {
    const base = applied(GENERIC_PROFILE);
    const target = clone(GENERIC_PROFILE);
    target.version = "1.1.0";
    target.contributions.find((item) => item.kind === "pipeline")!.name = "Novo nome";
    const local = rows(target);
    const plan = planBusinessProfileChanges({ base, local, target });
    expect(pick(plan, "pipeline.main").classification).toBe("CONFLICT");
    expect(pick(plan, "pipeline.main").reason).toMatch(/reassumir gestão/);
  });

  it("recusa recurso gerido ausente, identidade trocada e nome alheio ocupado", () => {
    const base = applied(GENERIC_PROFILE);
    const missing = planBusinessProfileChanges({
      base, local: rows(GENERIC_PROFILE).filter((item) => item.contributionKey !== "pipeline.main"), target: GENERIC_PROFILE,
    });
    expect(pick(missing, "pipeline.main").classification).toBe("CONFLICT");

    const swapped = rows(GENERIC_PROFILE);
    swapped[0]!.resourceId = "outro-recurso";
    expect(pick(planBusinessProfileChanges({ base, local: swapped, target: GENERIC_PROFILE }), "pipeline.main").classification).toBe("CONFLICT");

    const foreign: ProfileResourceSnapshot = {
      contributionKey: null, resourceKind: "pipeline", resourceId: "pipeline-alheio", parentKey: null,
      value: { name: "Clientes", isDefault: true },
    };
    const collision = planBusinessProfileChanges({ base: null, local: [foreign], target: GENERIC_PROFILE });
    expect(pick(collision, "pipeline.main").classification).toBe("CONFLICT");
    expect(pick(collision, "pipeline.main").resourceId).toBe("pipeline-alheio");
    expect(pick(collision, "pipeline.main").local).toEqual({ name: "Clientes", isDefault: true });
    expect(pick(collision, "stage.main.new").classification).toBe("CONFLICT");
    expect(pick(collision, "stage.main.new").blocked).toBe(true);
  });

  it("classifica remoção como DESTRUCTIVE sem excluir nada", () => {
    const base = applied(SALON_PROFILE);
    const target = clone(SALON_PROFILE);
    target.version = "1.1.0";
    target.contributions = target.contributions.filter((item) => item.kind !== "field");
    const plan = planBusinessProfileChanges({ base, local: rows(SALON_PROFILE), target });
    expect(pick(plan, "field.main.servico_desejado").classification).toBe("DESTRUCTIVE");
    expect(pick(plan, "field.main.profissional_preferido").blocked).toBe(true);
  });

  it("não chama mudança operacional de SAFE_METADATA", () => {
    const base = applied(GENERIC_PROFILE);
    const target = clone(GENERIC_PROFILE);
    target.version = "1.1.0";
    const firstStage = target.contributions.find((item) => item.kind === "stage" && item.step === "new")!;
    if (firstStage.kind !== "stage") throw new Error("Etapa de prova ausente");
    firstStage.position = 8;
    const plan = planBusinessProfileChanges({ base, local: rows(GENERIC_PROFILE), target });
    expect(pick(plan, "stage.main.new").classification).toBe("CONFLICT");
  });

  it("permutação das entradas não altera plano nem hash", () => {
    const base = applied(SALON_PROFILE);
    const local = rows(SALON_PROFILE);
    const target = clone(SALON_PROFILE);
    target.version = "1.1.0";
    target.contributions.find((item) => item.kind === "field")!.label = "Serviço procurado";
    const first = planBusinessProfileChanges({ base, local, target });
    const second = planBusinessProfileChanges({
      base: { ...base, contributions: [...base.contributions].reverse() },
      local: [...local].reverse(),
      target: { ...target, contributions: [...target.contributions].reverse() },
    });
    expect(second).toEqual(first);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("não inclui dados operacionais recebidos por engano em snapshots", () => {
    const unsafe = { ...rows(GENERIC_PROFILE)[0]!, value: { name: "Clientes", isDefault: false, lead_id: "segredo" } };
    expect(() => planBusinessProfileChanges({ base: null, local: [unsafe as ProfileResourceSnapshot], target: GENERIC_PROFILE })).toThrow();
  });
});
