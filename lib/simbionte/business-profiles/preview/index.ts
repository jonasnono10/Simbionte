import { businessProfileDigest } from "../canonical";
import { getBusinessProfile } from "../catalog";
import { planBusinessProfileChanges, type AppliedProfileBase } from "../planner";
import { loadContributions, loadInstallation, loadLocal, type PreviewClient } from "./adapter";
import { persistedSnapshot, PreviewError } from "./contracts";

export async function buildBusinessProfilePreview(input: {
  client: PreviewClient;
  orgId: string;
  profileId: string;
}) {
  const target = getBusinessProfile(input.profileId);
  if (!target) throw new PreviewError("PROFILE_NOT_FOUND", "catalog");
  const installation = await loadInstallation(input.client, input.orgId);
  if (installation && installation.profile_id !== target.id) {
    throw new PreviewError("PROFILE_SWITCH_NOT_SUPPORTED", "installation");
  }
  const contributions = installation
    ? await loadContributions(input.client, input.orgId, installation.profile_id)
    : [];
  const base: AppliedProfileBase | null = installation
    ? {
        profileId: installation.profile_id,
        version: installation.applied_version,
        contributions: contributions
          .filter((c) => c.state === "managed" || c.state === "drifted")
          .map(persistedSnapshot),
      }
    : null;
  const local = await loadLocal(input.client, input.orgId, contributions);
  const plan = planBusinessProfileChanges({ base, local, target });
  const count = (classification: string) =>
    plan.changes.filter((c) => c.classification === classification).length;
  return {
    profile: {
      id: target.id,
      displayName: target.displayName,
      version: target.version,
      digest: businessProfileDigest(target),
    },
    installation: {
      installed: installation !== null,
      profileId: installation?.profile_id ?? null,
      appliedVersion: installation?.applied_version ?? null,
      status: installation?.status ?? null,
      revision: installation?.revision ?? null,
    },
    summary: {
      unchanged: count("UNCHANGED"),
      safeAdd: count("SAFE_ADD"),
      safeMetadata: count("SAFE_METADATA"),
      localDrift: count("LOCAL_DRIFT"),
      conflict: count("CONFLICT"),
      destructive: count("DESTRUCTIVE"),
      blocked: plan.changes.filter((c) => c.blocked).length,
      decisionRequired: plan.changes.filter((c) => c.decisionRequired).length,
    },
    plan: { planHash: plan.planHash, changes: plan.changes },
    capabilities: { preview: true, apply: false },
  };
}
