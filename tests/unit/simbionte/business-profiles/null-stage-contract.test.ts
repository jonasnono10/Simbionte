import { describe, expect, it } from "vitest";

import { GENERIC_PROFILE, SALON_PROFILE } from "@/lib/simbionte/business-profiles/catalog";
import { parseBusinessProfileManifest, STAGE_STEPS } from "@/lib/simbionte/business-profiles/manifest";
import {
  planBusinessProfileChanges, type AppliedProfileBase, type ProfileResourceSnapshot,
} from "@/lib/simbionte/business-profiles/planner";

type StageSnapshot = Extract<ProfileResourceSnapshot, { resourceKind: "stage" }>;
const key = "stage.main.qualified";

function stage(step: StageSnapshot["value"]["step"] = "qualified"): StageSnapshot {
  return {
    contributionKey: key, resourceKind: "stage", resourceRef: "stage-qualified",
    parentKey: "pipeline.main",
    value: { name: "Proposta enviada", step, position: 4, isWon: false, isLost: false },
  };
}

function base(row = stage()): AppliedProfileBase {
  return { profileId: GENERIC_PROFILE.id, version: GENERIC_PROFILE.version, contributions: [row] };
}

function plan(local: ProfileResourceSnapshot[], target: unknown = GENERIC_PROFILE, prior = base()) {
  return planBusinessProfileChanges({ base: prior, local, target });
}

function change(result: ReturnType<typeof planBusinessProfileChanges>) {
  return result.changes.find((item) => item.contributionKey === key)!;
}

describe("snapshot de etapa sem passo do agente — F2.3C.0", () => {
  it.each([GENERIC_PROFILE, SALON_PROFILE])("TARGET $id continua recusando step:null", (profile) => {
    const invalid = {
      ...profile,
      contributions: profile.contributions.map((item) =>
        item.kind === "stage" && item.step === "qualified" ? { ...item, step: null } : item),
    };
    expect(() => parseBusinessProfileManifest(invalid)).toThrow();
    expect(() => planBusinessProfileChanges({ base: null, local: [], target: invalid })).toThrow();
  });

  it("LOCAL null é válido e permanece null, sem inferência por nome/posição", () => {
    const observed = stage(null);
    const result = change(plan([observed]));
    expect(result.local).toEqual(observed.value);
    expect(observed.value.step).toBeNull();
    expect(result.resourceRef).toBe(observed.resourceRef);
  });

  it("BASE qualified, LOCAL null, TARGET qualified preserva LOCAL_DRIFT", () => {
    const result = change(plan([stage(null)]));
    expect(result.classification).toBe("LOCAL_DRIFT");
    expect(result.local).toMatchObject({ step: null });
    expect(result.base).toMatchObject({ step: "qualified" });
    expect(result.target).toMatchObject({ step: "qualified" });
    expect(result.blocked).toBe(false);
    expect(result.decisionRequired).toBe(true);
  });

  it("BASE qualified, LOCAL null, TARGET negotiating gera CONFLICT", () => {
    // Troca os dois passos para manter o TARGET válido e sem passo duplicado.
    const target = {
      ...GENERIC_PROFILE,
      contributions: GENERIC_PROFILE.contributions.map((item) =>
        item.kind !== "stage" ? item : {
          ...item,
          step: item.step === "qualified" ? "negotiating" :
            item.step === "negotiating" ? "qualified" : item.step,
        }),
    };
    const result = change(plan([stage(null)], target));
    expect(result.classification).toBe("CONFLICT");
    expect(result.blocked).toBe(true);
    expect(result.local).toMatchObject({ step: null });
    expect(result.target).toMatchObject({ step: "negotiating" });
  });

  it("etapa não gerida com mesmo nome e step:null continua colisão", () => {
    const foreign: StageSnapshot = { ...stage(null), contributionKey: null, resourceRef: "stage-alheia" };
    const result = change(planBusinessProfileChanges({
      base: null, local: [foreign], target: GENERIC_PROFILE,
    }));
    expect(result.classification).toBe("CONFLICT");
    expect(result.blocked).toBe(true);
    expect(result.resourceRef).toBe("stage-alheia");
    expect(result.local).toMatchObject({ step: null });
  });

  it.each(["desconhecido", "", "QUALIFIED"])("snapshot recusa passo arbitrário %j em BASE e LOCAL", (step) => {
    const invalid = { ...stage(), value: { ...stage().value, step } } as StageSnapshot;
    expect(() => plan([invalid])).toThrow();
    expect(() => plan([], GENERIC_PROFILE, base(invalid))).toThrow();
  });

  it("snapshot persistido BASE também pode ter null, sem virar metadata segura", () => {
    const result = change(plan([stage(null)], GENERIC_PROFILE, base(stage(null))));
    expect(result.base).toMatchObject({ step: null });
    expect(result.classification).toBe("CONFLICT");
  });

  it("recurso ausente é diferente de etapa presente sem mapeamento", () => {
    const missing = change(plan([]));
    const unmapped = change(plan([stage(null)]));
    expect(missing.classification).toBe("CONFLICT");
    expect(missing.local).toBeNull();
    expect(unmapped.classification).toBe("LOCAL_DRIFT");
    expect(unmapped.local).toMatchObject({ step: null });
  });

  it.each(["isWon", "isLost"] as const)("não infere passo de %s", (flag) => {
    const observed = stage(null);
    observed.value[flag] = true;
    expect(change(plan([observed])).local).toEqual(observed.value);
    expect(change(plan([observed])).local).toMatchObject({ step: null, [flag]: true });
  });

  it("sete passos explícitos continuam válidos", () => {
    for (const step of STAGE_STEPS) {
      expect(() => plan([stage(step)])).not.toThrow();
    }
  });

  it("planHash com null é determinístico sob permutação e não altera entradas", () => {
    const prior = base();
    const local: ProfileResourceSnapshot[] = [
      stage(null),
      { ...stage(null), contributionKey: null, resourceRef: "stage-outra", value: { ...stage(null).value, name: "Outra etapa" } },
    ];
    const before = structuredClone({ prior, local, target: GENERIC_PROFILE });
    const first = plan(local, GENERIC_PROFILE, prior);
    const second = plan([...local].reverse(), {
      ...GENERIC_PROFILE, contributions: [...GENERIC_PROFILE.contributions].reverse(),
    }, { ...prior, contributions: [...prior.contributions].reverse() });
    expect(second).toEqual(first);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect({ prior, local, target: GENERIC_PROFILE }).toEqual(before);
    expect(plan([stage()]).planHash).not.toBe(plan([stage(null)]).planHash);
  });
});
