import { z } from "zod";

import type { Database } from "@/lib/database.types";
import { STAGE_STEPS } from "../manifest";
import type { ProfileResourceSnapshot } from "../planner";

export class PreviewError extends Error {
  constructor(
    readonly code:
      | "PROFILE_NOT_FOUND"
      | "PROFILE_SWITCH_NOT_SUPPORTED"
      | "PREVIEW_READ_ERROR"
      | "PREVIEW_STATE_INVALID",
    readonly source: string,
  ) {
    super(code);
    this.name = "PreviewError";
  }
}

export function parseState<T>(schema: z.ZodType<T>, input: unknown, source: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PreviewError("PREVIEW_STATE_INVALID", source);
  return parsed.data;
}

export const installationSchema = z.object({
  profile_id: z.string().min(1),
  applied_version: z.string().min(1),
  status: z.enum(["active", "disabled"]),
  revision: z.number().int().positive(),
});
export type Installation = Pick<
  Database["public"]["Tables"]["business_profile_installations"]["Row"],
  "profile_id" | "applied_version" | "status" | "revision"
>;

export const contributionSchema = z.object({
  contribution_key: z.string().regex(/^(pipeline|stage|field)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/),
  resource_kind: z.enum(["pipeline", "stage", "field"]),
  resource_ref: z.string().min(1),
  parent_contribution_key: z.string().nullable(),
  managed_value: z.unknown(),
  state: z.enum(["managed", "drifted", "released", "retired"]),
});
export type Contribution = z.infer<typeof contributionSchema>;

// Parsing de projeções do adapter, não um segundo planner. As chaves/refs vêm
// da proveniência; managed_value contém exclusivamente value, não a linha CRM.
const pipelineValue = z.strictObject({ name: z.string(), isDefault: z.boolean() });
const stageValue = z.strictObject({
  name: z.string(),
  step: z.enum(STAGE_STEPS).nullable(),
  position: z.number(),
  isWon: z.boolean(),
  isLost: z.boolean(),
});
const fieldValue = z.strictObject({
  fieldKey: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
});

export function persistedSnapshot(row: Contribution): ProfileResourceSnapshot {
  if (!row.contribution_key.startsWith(row.resource_kind + ".")) {
    throw new PreviewError("PREVIEW_STATE_INVALID", "contribution_kind");
  }
  const identity = { contributionKey: row.contribution_key, resourceRef: row.resource_ref };
  if (row.resource_kind === "pipeline") {
    if (row.parent_contribution_key !== null)
      throw new PreviewError("PREVIEW_STATE_INVALID", "pipeline_parent");
    return {
      ...identity,
      resourceKind: "pipeline",
      parentKey: null,
      value: parseState(pipelineValue, row.managed_value, "managed_pipeline"),
    };
  }
  const parentKey = parseState(
    z.string().regex(/^pipeline\.[a-z0-9_]+$/),
    row.parent_contribution_key,
    "managed_parent",
  );
  if (row.resource_kind === "stage") {
    return {
      ...identity,
      resourceKind: "stage",
      parentKey,
      value: parseState(stageValue, row.managed_value, "managed_stage"),
    };
  }
  return {
    ...identity,
    resourceKind: "field",
    parentKey,
    value: parseState(fieldValue, row.managed_value, "managed_field"),
  };
}

export const pipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  is_default: z.boolean(),
  settings: z.unknown(),
});
export const stageSchema = z.object({
  id: z.string().min(1),
  pipeline_id: z.string().min(1),
  name: z.string(),
  position: z.number(),
  is_won: z.boolean(),
  is_lost: z.boolean(),
  agent_stage_hint: z.enum(STAGE_STEPS).nullable(),
});
