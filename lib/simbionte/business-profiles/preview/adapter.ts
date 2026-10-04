import { z } from "zod";

import { customFieldSchema } from "@/lib/schemas/settings";
import type { createClient } from "@/lib/supabase/server";
import type { ProfileResourceSnapshot } from "../planner";
import {
  contributionSchema,
  installationSchema,
  parseState,
  pipelineSchema,
  PreviewError,
  stageSchema,
  type Contribution,
  type Installation,
} from "./contracts";

export type PreviewClient = Pick<Awaited<ReturnType<typeof createClient>>, "from">;
type ReadTable = "business_profile_contributions" | "crm_pipelines" | "crm_stages";
const PAGE_SIZE = 1000;

/** Referência embutida, estável e opaca: não é UUID nem chave TARGET. */
export const fieldResourceRef = (pipelineRef: string, fieldKey: string): string =>
  `crm-pipeline:${pipelineRef}:field:${fieldKey}`;

async function readAll(
  client: PreviewClient,
  table: ReadTable,
  columns: string,
  orgId: string,
  profileId?: string,
) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = client.from(table).select(columns, { count: "exact" }).eq("organization_id", orgId);
    if (profileId) query = query.eq("profile_id", profileId);
    const { data, error, count } = await query.order("id").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new PreviewError("PREVIEW_READ_ERROR", table);
    const page = parseState(z.array(z.unknown()), data, table);
    // O servidor pode limitar abaixo de PAGE_SIZE; count impede um falso LOCAL vazio/parcial.
    if (typeof count !== "number" || count < rows.length + page.length) {
      throw new PreviewError("PREVIEW_READ_ERROR", table + "_count");
    }
    rows.push(...page);
    if (rows.length === count) return rows;
    if (page.length !== PAGE_SIZE)
      throw new PreviewError("PREVIEW_READ_ERROR", table + "_truncated");
  }
}

export async function loadInstallation(
  client: PreviewClient,
  orgId: string,
): Promise<Installation | null> {
  const { data, error } = await client
    .from("business_profile_installations")
    .select("profile_id,applied_version,status,revision")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new PreviewError("PREVIEW_READ_ERROR", "business_profile_installations");
  return data === null ? null : parseState(installationSchema, data, "installation");
}

export async function loadContributions(
  client: PreviewClient,
  orgId: string,
  profileId: string,
): Promise<Contribution[]> {
  return parseState(
    z.array(contributionSchema),
    await readAll(
      client,
      "business_profile_contributions",
      "id,contribution_key,resource_kind,resource_ref,parent_contribution_key,managed_value,state",
      orgId,
      profileId,
    ),
    "contributions",
  );
}

export async function loadLocal(
  client: PreviewClient,
  orgId: string,
  contributions: Contribution[],
): Promise<ProfileResourceSnapshot[]> {
  const [rawPipelines, rawStages] = await Promise.all([
    readAll(client, "crm_pipelines", "id,name,is_default,settings", orgId),
    readAll(
      client,
      "crm_stages",
      "id,pipeline_id,name,position,is_won,is_lost,agent_stage_hint",
      orgId,
    ),
  ]);
  const pipelines = parseState(z.array(pipelineSchema), rawPipelines, "pipelines");
  const stages = parseState(z.array(stageSchema), rawStages, "stages");
  const managed = new Map<string, Contribution>();
  for (const c of contributions.filter((c) => c.state === "managed" || c.state === "drifted")) {
    const key = c.resource_kind + ":" + c.resource_ref;
    if (managed.has(key)) throw new PreviewError("PREVIEW_STATE_INVALID", "duplicate_managed_ref");
    managed.set(key, c);
  }
  const parents = new Map(
    pipelines.map((p) => [
      p.id,
      managed.get("pipeline:" + p.id)?.contribution_key ?? "local-pipeline:" + p.id,
    ]),
  );
  const local: ProfileResourceSnapshot[] = [];
  const parentOf = (pipelineRef: string, c: Contribution | undefined): string => {
    const actual = parents.get(pipelineRef);
    if (!actual) throw new PreviewError("PREVIEW_STATE_INVALID", "missing_local_pipeline");
    if (!c) return actual;
    const persistedParent = contributions.find(
      (p) => p.contribution_key === c.parent_contribution_key && p.resource_kind === "pipeline",
    );
    if (
      !persistedParent ||
      persistedParent.resource_ref !== pipelineRef ||
      !c.parent_contribution_key
    ) {
      throw new PreviewError("PREVIEW_STATE_INVALID", "inconsistent_managed_parent");
    }
    return c.parent_contribution_key;
  };
  for (const p of pipelines) {
    const c = managed.get("pipeline:" + p.id);
    local.push({
      resourceKind: "pipeline",
      resourceRef: p.id,
      contributionKey: c?.contribution_key ?? null,
      parentKey: null,
      value: { name: p.name, isDefault: p.is_default },
    });
    const settings =
      p.settings === null || p.settings === undefined
        ? {}
        : parseState(z.record(z.string(), z.unknown()), p.settings, "pipeline_settings");
    const fields =
      settings.fields === undefined
        ? []
        : parseState(z.array(customFieldSchema), settings.fields, "pipeline_fields");
    const keys = new Set<string>();
    for (const f of fields) {
      if (keys.has(f.key)) throw new PreviewError("PREVIEW_STATE_INVALID", "duplicate_field_key");
      keys.add(f.key);
      const ref = fieldResourceRef(p.id, f.key);
      const contribution = managed.get("field:" + ref);
      local.push({
        resourceKind: "field",
        resourceRef: ref,
        contributionKey: contribution?.contribution_key ?? null,
        parentKey: parentOf(p.id, contribution),
        value: { fieldKey: f.key, label: f.label, type: f.type, required: f.required ?? false },
      });
    }
  }
  for (const s of stages) {
    const c = managed.get("stage:" + s.id);
    local.push({
      resourceKind: "stage",
      resourceRef: s.id,
      contributionKey: c?.contribution_key ?? null,
      parentKey: parentOf(s.pipeline_id, c),
      value: {
        name: s.name,
        step: s.agent_stage_hint,
        position: s.position,
        isWon: s.is_won,
        isLost: s.is_lost,
      },
    });
  }
  return local;
}
