import { z } from "zod";

/** Contrato F2.3A: propostas de configuração, nunca dados ou ações operacionais. */
export const PROFILE_FORMAT_VERSION = 1;
export const PROFILE_API_VERSION = 1;

const text = (max: number) =>
  z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(max));
const profileId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const contributionKey = z.string().regex(/^(pipeline|stage|field)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/);
const semver = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
);

export const STAGE_STEPS = [
  "new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost",
] as const;

const pipeline = z.strictObject({
  kind: z.literal("pipeline"),
  key: contributionKey,
  name: text(80),
  isDefault: z.literal(false),
});
const stage = z.strictObject({
  kind: z.literal("stage"),
  key: contributionKey,
  pipelineKey: contributionKey,
  name: text(80),
  step: z.enum(STAGE_STEPS),
  position: z.number().int().min(1).max(8),
});
const field = z.strictObject({
  kind: z.literal("field"),
  key: contributionKey,
  pipelineKey: contributionKey,
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: text(80),
  type: z.literal("text"),
  required: z.literal(false),
});

const contribution = z.discriminatedUnion("kind", [pipeline, stage, field]);
const manifestSchema = z.strictObject({
  formatVersion: z.literal(PROFILE_FORMAT_VERSION),
  id: profileId,
  version: semver,
  displayName: text(100),
  description: text(400),
  compatibility: z.strictObject({
    profileApi: z.strictObject({ min: z.literal(PROFILE_API_VERSION), max: z.literal(PROFILE_API_VERSION) }),
  }),
  contributions: z.array(contribution).min(1).max(40),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  const pipelines = new Set(manifest.contributions.filter((item) => item.kind === "pipeline").map((item) => item.key));
  const steps = new Map<string, Set<string>>();
  const positions = new Map<string, Set<number>>();
  const fields = new Map<string, Set<string>>();

  manifest.contributions.forEach((item, index) => {
    const issue = (message: string) => context.addIssue({ code: "custom", path: ["contributions", index], message });
    if (seen.has(item.key)) issue(`Chave de contribuição duplicada: ${item.key}`);
    seen.add(item.key);
    if (item.kind === "pipeline") {
      if (!/^pipeline\.[a-z0-9_]+$/.test(item.key)) issue("Chave de pipeline inválida");
      return;
    }
    const expectedPrefix = `${item.kind}.${item.pipelineKey.slice("pipeline.".length)}.`;
    if (!pipelines.has(item.pipelineKey)) issue(`Pipeline pai inexistente: ${item.pipelineKey}`);
    if (!item.key.startsWith(expectedPrefix) || !/^pipeline\.[a-z0-9_]+$/.test(item.pipelineKey)) {
      issue("Chave ou referência de pai incompatível");
    }
    if (item.kind === "stage") {
      const usedSteps = steps.get(item.pipelineKey) ?? new Set<string>();
      if (usedSteps.has(item.step)) issue(`Passo duplicado: ${item.step}`);
      usedSteps.add(item.step);
      steps.set(item.pipelineKey, usedSteps);
      const usedPositions = positions.get(item.pipelineKey) ?? new Set<number>();
      if (usedPositions.has(item.position)) issue(`Posição duplicada: ${item.position}`);
      usedPositions.add(item.position);
      positions.set(item.pipelineKey, usedPositions);
    } else {
      const usedFields = fields.get(item.pipelineKey) ?? new Set<string>();
      if (usedFields.has(item.fieldKey)) issue(`Campo duplicado: ${item.fieldKey}`);
      usedFields.add(item.fieldKey);
      fields.set(item.pipelineKey, usedFields);
    }
  });
  for (const key of pipelines) {
    const assigned = steps.get(key) ?? new Set<string>();
    const count = positions.get(key)?.size ?? 0;
    if (count < 4 || count > 8) context.addIssue({ code: "custom", message: `${key}: são necessárias 4 a 8 etapas` });
    if (!assigned.has("won")) context.addIssue({ code: "custom", message: `${key}: etapa won ausente` });
    if (!assigned.has("lost")) context.addIssue({ code: "custom", message: `${key}: etapa lost ausente` });
  }
});

export type BusinessProfileManifest = z.infer<typeof manifestSchema>;
export type ProfileContribution = BusinessProfileManifest["contributions"][number];
export type ResourceKind = ProfileContribution["kind"];

export type BlockedDomain = "PRIVILEGE_EXPANSION" | "EXTERNAL_EFFECT";
export class UnsupportedProfileDomainError extends Error {
  constructor(readonly domain: string, readonly classification: BlockedDomain) {
    super(`Domínio não suportado em F2.3A: ${domain} (${classification})`);
    this.name = "UnsupportedProfileDomainError";
  }
}

/** Sinaliza a categoria bloqueada, mas nunca torna o domínio aplicável. */
export function blockedDomain(candidate: unknown): BlockedDomain | null {
  if (!candidate || typeof candidate !== "object" || !("kind" in candidate)) return null;
  const kind = String(candidate.kind);
  if (["permission", "role", "autonomy", "agent_authority"].includes(kind)) return "PRIVILEGE_EXPANSION";
  if (["agent", "automation", "message", "followup", "webhook"].includes(kind)) return "EXTERNAL_EFFECT";
  return null;
}

export function parseBusinessProfileManifest(input: unknown): BusinessProfileManifest {
  if (input && typeof input === "object" && "contributions" in input && Array.isArray(input.contributions)) {
    for (const item of input.contributions) {
      const blocked = blockedDomain(item);
      if (blocked) throw new UnsupportedProfileDomainError(String(item.kind), blocked);
    }
  }
  return manifestSchema.parse(input);
}
