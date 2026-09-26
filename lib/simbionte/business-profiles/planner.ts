import { z } from "zod";

import { compareKeys, normalizeBusinessProfileManifest, RESOURCE_ORDER, sha256Canonical } from "./canonical";
import type { ProfileContribution, ResourceKind } from "./manifest";

const pipelineValue = z.strictObject({ name: z.string(), isDefault: z.boolean() });
const stageValue = z.strictObject({
  name: z.string(), step: z.string(), position: z.number(), isWon: z.boolean(), isLost: z.boolean(),
});
const fieldValue = z.strictObject({
  fieldKey: z.string(), label: z.string(), type: z.string(), required: z.boolean(),
});
const snapshot = z.discriminatedUnion("resourceKind", [
  z.strictObject({ contributionKey: z.string().nullable(), resourceKind: z.literal("pipeline"), resourceRef: z.string().min(1), parentKey: z.null().optional(), value: pipelineValue }),
  z.strictObject({ contributionKey: z.string().nullable(), resourceKind: z.literal("stage"), resourceRef: z.string().min(1), parentKey: z.string(), value: stageValue }),
  z.strictObject({ contributionKey: z.string().nullable(), resourceKind: z.literal("field"), resourceRef: z.string().min(1), parentKey: z.string(), value: fieldValue }),
]);

export type ProfileResourceSnapshot = z.infer<typeof snapshot>;
export type ProfileValue = ProfileResourceSnapshot["value"];
export type AppliedProfileBase = {
  profileId: string;
  version: string;
  contributions: ProfileResourceSnapshot[];
};
export type ProfileChangeClass =
  | "UNCHANGED" | "SAFE_ADD" | "SAFE_METADATA" | "LOCAL_DRIFT" | "CONFLICT"
  | "DESTRUCTIVE" | "PRIVILEGE_EXPANSION" | "EXTERNAL_EFFECT";

export type ProfilePlanChange = {
  classification: ProfileChangeClass;
  contributionKey: string;
  resourceKind: ResourceKind;
  resourceRef: string | null;
  parentKey: string | null;
  base: ProfileValue | null;
  local: ProfileValue | null;
  target: ProfileValue | null;
  decisionRequired: boolean;
  blocked: boolean;
  reason: string;
};

export type BusinessProfilePlan = {
  profileId: string;
  fromVersion: string | null;
  targetVersion: string;
  targetDigest: string;
  changes: ProfilePlanChange[];
  planHash: string;
};

function valueOf(item: ProfileContribution): ProfileValue {
  switch (item.kind) {
    case "pipeline": return { name: item.name, isDefault: item.isDefault };
    case "stage": return {
      name: item.name, step: item.step, position: item.position,
      isWon: item.step === "won", isLost: item.step === "lost",
    };
    case "field": return { fieldKey: item.fieldKey, label: item.label, type: item.type, required: item.required };
  }
}

function parentOf(item: ProfileContribution): string | null {
  return item.kind === "pipeline" ? null : item.pipelineKey;
}

function equal(a: unknown, b: unknown): boolean {
  return sha256Canonical(a) === sha256Canonical(b);
}

function safeMetadata(kind: ResourceKind, base: ProfileValue, target: ProfileValue): boolean {
  const permitted = kind === "field" ? "label" : "name";
  const before = base as unknown as Record<string, unknown>;
  const after = target as unknown as Record<string, unknown>;
  return Object.keys({ ...before, ...after }).every((key) => key === permitted || equal(before[key], after[key]));
}

function displayIdentity(kind: ResourceKind, value: ProfileValue): string {
  if (kind === "field") return (value as { fieldKey: string }).fieldKey.toLowerCase();
  return (value as { name: string }).name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function classify(
  base: ProfileResourceSnapshot | undefined,
  local: ProfileResourceSnapshot | undefined,
  target: ProfileContribution | undefined,
  collision: boolean,
): Pick<ProfilePlanChange, "classification" | "reason"> {
  if (!target) return { classification: "DESTRUCTIVE", reason: "A versão alvo remove uma contribuição aplicada; F2.3A não remove recursos." };
  if (!base) {
    if (local || collision) return { classification: "CONFLICT", reason: "Recurso existente ou nome/chave ocupado não pode ser adotado por inferência." };
    return { classification: "SAFE_ADD", reason: "Nova configuração proposta, sem alterar recurso existente." };
  }
  if (!local) return { classification: "CONFLICT", reason: "Recurso antes gerido está ausente; exige reconciliação explícita." };
  if (base.resourceKind !== target.kind || local.resourceKind !== target.kind || base.resourceRef !== local.resourceRef) {
    return { classification: "CONFLICT", reason: "Identidade ou tipo do recurso gerido mudou." };
  }
  const targetValue = valueOf(target);
  const localIsBase = equal(local.value, base.value);
  const targetIsBase = equal(targetValue, base.value);
  if (localIsBase && targetIsBase) return { classification: "UNCHANGED", reason: "Recurso e proposta equivalem ao último valor aplicado." };
  if (localIsBase) {
    return safeMetadata(target.kind, base.value, targetValue)
      ? { classification: "SAFE_METADATA", reason: "Somente rótulo gerido mudou, sem edição local." }
      : { classification: "CONFLICT", reason: "Mudança de configuração operacional exige decisão específica." };
  }
  if (targetIsBase) return { classification: "LOCAL_DRIFT", reason: "Edição local preservada; o perfil não a sobrescreve." };
  if (equal(local.value, targetValue)) {
    return { classification: "CONFLICT", reason: "Local já equivale ao alvo, mas reassumir gestão exige decisão explícita." };
  }
  return { classification: "CONFLICT", reason: "Base, estado local e alvo divergem; não sobrescrever edição humana." };
}

function indexSnapshots(rows: ProfileResourceSnapshot[], label: string): Map<string, ProfileResourceSnapshot> {
  const index = new Map<string, ProfileResourceSnapshot>();
  const resourceRefs = new Set<string>();
  for (const raw of rows) {
    const row = snapshot.parse(raw);
    const identity = `${row.resourceKind}:${row.resourceRef}`;
    if (resourceRefs.has(identity)) throw new Error(`${label}: recurso duplicado ${identity}`);
    resourceRefs.add(identity);
    if (row.contributionKey === null) {
      if (label === "BASE") throw new Error("BASE: contribuição aplicada sem chave");
      continue;
    }
    if (index.has(row.contributionKey)) throw new Error(`${label}: contribuição duplicada ${row.contributionKey}`);
    index.set(row.contributionKey, row);
  }
  return index;
}

/** Planeja somente: não acessa ambiente, banco, relógio, rede nem gera IDs. */
export function planBusinessProfileChanges(input: {
  base: AppliedProfileBase | null;
  local: ProfileResourceSnapshot[];
  target: unknown;
}): BusinessProfilePlan {
  const target = normalizeBusinessProfileManifest(input.target);
  if (input.base && input.base.profileId !== target.id) {
    throw new Error("Troca de identidade de perfil não é suportada pelo planejador F2.3A");
  }
  const base = indexSnapshots(input.base?.contributions ?? [], "BASE");
  const local = indexSnapshots(input.local, "LOCAL");
  const allLocal = input.local.map((row) => snapshot.parse(row)).sort(
    (a, b) => RESOURCE_ORDER[a.resourceKind] - RESOURCE_ORDER[b.resourceKind]
      || compareKeys(a.parentKey ?? "", b.parentKey ?? "") || compareKeys(a.resourceRef, b.resourceRef),
  );
  const wanted = new Map(target.contributions.map((item) => [item.key, item]));
  const keys = new Set([...base.keys(), ...wanted.keys()]);
  const changes = [...keys].map((key): ProfilePlanChange => {
    const prior = base.get(key);
    const current = local.get(key);
    const next = wanted.get(key);
    const kind = next?.kind ?? prior?.resourceKind;
    if (!kind) throw new Error(`Contribuição sem tipo: ${key}`);
    const parentKey = next ? parentOf(next) : prior?.parentKey ?? null;
    const nextValue = next ? valueOf(next) : null;
    const collision = next && !prior && !current ? allLocal.find((row) =>
      row.contributionKey !== key && row.resourceKind === kind && (row.parentKey ?? null) === parentKey &&
      displayIdentity(kind, row.value) === displayIdentity(kind, nextValue!),
    ) : undefined;
    const verdict = classify(prior, current, next, !!collision);
    return {
      ...verdict,
      contributionKey: key,
      resourceKind: kind,
      resourceRef: current?.resourceRef ?? collision?.resourceRef ?? prior?.resourceRef ?? null,
      parentKey,
      base: prior?.value ?? null,
      local: current?.value ?? collision?.value ?? null,
      target: nextValue,
      decisionRequired: !["UNCHANGED"].includes(verdict.classification),
      blocked: ["CONFLICT", "DESTRUCTIVE", "PRIVILEGE_EXPANSION", "EXTERNAL_EFFECT"].includes(verdict.classification),
    };
  }).sort((a, b) => RESOURCE_ORDER[a.resourceKind] - RESOURCE_ORDER[b.resourceKind] || compareKeys(a.contributionKey, b.contributionKey));

  // Filho nunca pode parecer aplicável quando a identidade do pai está bloqueada.
  const byKey = new Map(changes.map((change) => [change.contributionKey, change]));
  for (const change of changes) {
    if (!change.parentKey || !byKey.get(change.parentKey)?.blocked || change.blocked) continue;
    change.classification = "CONFLICT";
    change.blocked = true;
    change.reason = `Pipeline pai ${change.parentKey} bloqueado; não aplicar contribuição dependente.`;
  }

  const withoutHash = {
    profileId: target.id,
    fromVersion: input.base?.version ?? null,
    targetVersion: target.version,
    targetDigest: sha256Canonical(target),
    changes,
  };
  return { ...withoutHash, planHash: sha256Canonical(withoutHash) };
}
