import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { buildBusinessProfilePreview } from "@/lib/simbionte/business-profiles/preview";
import { PreviewError } from "@/lib/simbionte/business-profiles/preview/contracts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const paramsSchema = z.strictObject({ profileId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) });

export async function GET(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const params = paramsSchema.safeParse(await context.params);
  // Query não tem contrato nesta rota: nem manifesto nem organização vêm do cliente.
  if (
    !params.success ||
    new URL(request.url).searchParams.size > 0 ||
    request.body !== null ||
    request.headers.has("organization_id") ||
    request.headers.has("x-organization-id")
  ) {
    return fail("invalid_request", "Parâmetros de preview inválidos.", 400, {
      requestId,
      headers: noStore,
    });
  }
  try {
    const authz = await requireRole("manager", {
      requestId,
      resource: "business_profiles",
      allowPlatformAdmin: "leitura",
    });
    if (!authz.ok) {
      // O guard é preservado; erro técnico de RPC não pode expor SQL na borda.
      if (authz.response.status >= 500) {
        throw new PreviewError("PREVIEW_READ_ERROR", "authorization");
      }
      authz.response.headers.set("Cache-Control", "no-store");
      return authz.response;
    }
    const client = await createClient();
    const preview = await buildBusinessProfilePreview({
      client,
      orgId: authz.org.orgId,
      profileId: params.data.profileId,
    });
    // O contrato de wire segue snake_case; o read model interno mantém o planner canônico.
    return ok(
      {
        profile: {
          id: preview.profile.id,
          display_name: preview.profile.displayName,
          version: preview.profile.version,
          digest: preview.profile.digest,
        },
        installation: {
          installed: preview.installation.installed,
          profile_id: preview.installation.profileId,
          applied_version: preview.installation.appliedVersion,
          status: preview.installation.status,
          revision: preview.installation.revision,
        },
        summary: {
          unchanged: preview.summary.unchanged,
          safe_add: preview.summary.safeAdd,
          safe_metadata: preview.summary.safeMetadata,
          local_drift: preview.summary.localDrift,
          conflict: preview.summary.conflict,
          destructive: preview.summary.destructive,
          blocked: preview.summary.blocked,
          decision_required: preview.summary.decisionRequired,
        },
        plan: {
          plan_hash: preview.plan.planHash,
          changes: preview.plan.changes.map((c) => ({
            classification: c.classification,
            contribution_key: c.contributionKey,
            resource_kind: c.resourceKind,
            resource_ref: c.resourceRef,
            parent_key: c.parentKey,
            base: c.base,
            local: c.local,
            target: c.target,
            decision_required: c.decisionRequired,
            blocked: c.blocked,
            reason: c.reason,
          })),
        },
        capabilities: preview.capabilities,
      },
      { requestId, headers: noStore },
    );
  } catch (error) {
    if (error instanceof PreviewError && error.code === "PROFILE_NOT_FOUND") {
      return fail("not_found", "Business Profile não encontrado.", 404, {
        requestId,
        headers: noStore,
      });
    }
    if (error instanceof PreviewError && error.code === "PROFILE_SWITCH_NOT_SUPPORTED") {
      return fail(error.code, "Troca de Business Profile não suportada.", 409, {
        requestId,
        headers: noStore,
      });
    }
    logger.error("business_profile.preview_failed", {
      requestId,
      source: error instanceof PreviewError ? error.source : "unexpected",
      code: error instanceof PreviewError ? error.code : "internal_error",
    });
    return fail("internal_error", "Não foi possível ler a configuração para o preview.", 500, {
      requestId,
      headers: noStore,
    });
  }
}
