import { describe, expect, it } from "vitest";
import { STAGE_STEPS } from "@/lib/simbionte/business-profiles/manifest";
import { buildBusinessProfilePreview } from "@/lib/simbionte/business-profiles/preview";
import {
  fieldResourceRef,
  loadContributions,
  loadLocal,
} from "@/lib/simbionte/business-profiles/preview/adapter";
import { contribution, installed, ORG_A, pipeline, previewFixture } from "./preview-fixture";

describe("preview: contratos de adapter e falha fechada", () => {
  it.each(STAGE_STEPS)("hint %s é preservado literalmente", async (hint) => {
    const f = previewFixture();
    f.tables.crm_pipelines.push(pipeline());
    f.tables.crm_stages.push({
      id: "s1",
      organization_id: ORG_A,
      pipeline_id: "p1",
      name: "Local",
      position: 1,
      is_won: false,
      is_lost: false,
      agent_stage_hint: hint,
    });
    expect(
      (await loadLocal(f.client, ORG_A, [])).find((r) => r.resourceKind === "stage")?.value,
    ).toMatchObject({ step: hint });
  });
  it.each(["released", "retired"])(
    "%s: stages e fields não recuperam chaves geridas",
    async (state) => {
      const f = previewFixture();
      f.tables.business_profile_contributions.push(
        contribution(),
        {
          ...contribution(),
          id: "c2",
          resource_kind: "stage",
          contribution_key: "stage.main.new",
          resource_ref: "s1",
          parent_contribution_key: "pipeline.main",
          state,
        },
        {
          ...contribution(),
          id: "c3",
          resource_kind: "field",
          contribution_key: "field.main.x",
          resource_ref: fieldResourceRef("p1", "x"),
          parent_contribution_key: "pipeline.main",
          state,
        },
      );
      f.tables.crm_pipelines.push({
        ...pipeline(),
        settings: { fields: [{ key: "x", label: "X", type: "text" }] },
      });
      f.tables.crm_stages.push({
        id: "s1",
        organization_id: ORG_A,
        pipeline_id: "p1",
        name: "Novo contato",
        position: 1,
        is_won: false,
        is_lost: false,
        agent_stage_hint: null,
      });
      const c = await loadContributions(f.client, ORG_A, "generico");
      const local = await loadLocal(f.client, ORG_A, c);
      expect(
        local
          .filter((r) => r.resourceKind !== "pipeline")
          .map((r) => [r.contributionKey, r.parentKey]),
      ).toEqual([
        [null, "pipeline.main"],
        [null, "pipeline.main"],
      ]);
    },
  );
  it("field gerido correlaciona por ref opaca e parent persistido, não label", async () => {
    const f = previewFixture();
    f.tables.business_profile_contributions.push(contribution(), {
      ...contribution(),
      id: "c2",
      resource_kind: "field",
      contribution_key: "field.main.x",
      resource_ref: fieldResourceRef("p1", "x"),
      parent_contribution_key: "pipeline.main",
      managed_value: { fieldKey: "x", label: "Antigo", type: "text", required: false },
    });
    f.tables.crm_pipelines.push({
      ...pipeline(),
      settings: { fields: [{ key: "x", label: "Humano", type: "text" }] },
    });
    const local = await loadLocal(
      f.client,
      ORG_A,
      await loadContributions(f.client, ORG_A, "generico"),
    );
    expect(local.find((r) => r.resourceKind === "field")).toMatchObject({
      contributionKey: "field.main.x",
      resourceRef: fieldResourceRef("p1", "x"),
      parentKey: "pipeline.main",
      value: { label: "Humano", required: false },
    });
  });
  it("ref estável não depende de label ou timestamp", () => {
    expect(fieldResourceRef("p1", "x")).toBe("crm-pipeline:p1:field:x");
    expect(fieldResourceRef("p1", "x")).toBe(fieldResourceRef("p1", "x"));
    expect(fieldResourceRef("p2", "x")).not.toBe(fieldResourceRef("p1", "x"));
  });
  it("limite servidor menor que a página aborta LOCAL parcial", async () => {
    const f = previewFixture();
    f.tables.crm_pipelines.push(pipeline("A", "p1"), pipeline("B", "p2"));
    f.paging.cap = 1;
    await expect(loadLocal(f.client, ORG_A, [])).rejects.toMatchObject({
      code: "PREVIEW_READ_ERROR",
      source: "crm_pipelines_truncated",
    });
  });
  it("count ausente não vira vazio seguro", async () => {
    const f = previewFixture();
    f.paging.omitCount = true;
    await expect(loadLocal(f.client, ORG_A, [])).rejects.toMatchObject({
      code: "PREVIEW_READ_ERROR",
    });
  });
  it("parent inconsistente aborta, sem reassociar por nome", async () => {
    const f = previewFixture();
    f.tables.business_profile_installations.push(installed());
    f.tables.business_profile_contributions.push(contribution(), {
      ...contribution(),
      id: "c2",
      resource_kind: "stage",
      contribution_key: "stage.main.new",
      resource_ref: "s1",
      parent_contribution_key: "pipeline.main",
      managed_value: {
        name: "Novo contato",
        step: "new",
        position: 1,
        isWon: false,
        isLost: false,
      },
    });
    f.tables.crm_pipelines.push(pipeline(), pipeline("Outro", "p2"));
    f.tables.crm_stages.push({
      id: "s1",
      organization_id: ORG_A,
      pipeline_id: "p2",
      name: "Novo contato",
      position: 1,
      is_won: false,
      is_lost: false,
      agent_stage_hint: "new",
    });
    await expect(
      buildBusinessProfilePreview({ client: f.client, orgId: ORG_A, profileId: "generico" }),
    ).rejects.toMatchObject({
      code: "PREVIEW_STATE_INVALID",
      source: "inconsistent_managed_parent",
    });
  });
});
