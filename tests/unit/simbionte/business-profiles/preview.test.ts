import { describe, expect, it } from "vitest";

import { BUSINESS_PROFILE_CATALOG } from "@/lib/simbionte/business-profiles/catalog";
import { buildBusinessProfilePreview } from "@/lib/simbionte/business-profiles/preview";
import { fieldResourceRef, loadLocal } from "@/lib/simbionte/business-profiles/preview/adapter";
import { contribution, installed, ORG_A, ORG_B, pipeline, previewFixture } from "./preview-fixture";

type Fixture = ReturnType<typeof previewFixture>;
const preview = (f: Fixture, profileId = "generico") =>
  buildBusinessProfilePreview({ client: f.client, orgId: ORG_A, profileId });
function managedFixture() {
  const f = previewFixture();
  f.tables.business_profile_installations.push(installed());
  f.tables.business_profile_contributions.push(contribution());
  f.tables.crm_pipelines.push(pipeline());
  return f;
}
const stage = (hint: unknown = null) => ({
  id: "s1",
  organization_id: ORG_A,
  pipeline_id: "p1",
  name: "Novo contato",
  position: 1,
  is_won: true,
  is_lost: true,
  agent_stage_hint: hint,
});
const pipelineClass = async (f: Fixture) =>
  (await preview(f)).plan.changes.find((c) => c.resourceKind === "pipeline")!.classification;

describe("preview real read-only", () => {
  it.each(BUSINESS_PROFILE_CATALOG)(
    "clean install $id propõe SAFE_ADD sem criar nada",
    async (profile) => {
      const f = previewFixture();
      const result = await preview(f, profile.id);
      expect(result.installation.installed).toBe(false);
      expect(result.summary.safeAdd).toBe(profile.contributions.length);
      expect(result.capabilities).toEqual({ preview: true, apply: false });
      expect(f.requests).toHaveLength(3);
      expect(f.requests.every((r) => r.method === "GET")).toBe(true);
      expect(f.requests.some((r) => r.table === "business_profile_operations")).toBe(false);
      expect(Object.values(f.tables).every((rows) => rows.length === 0)).toBe(true);
    },
  );

  it("não consulta DB para perfil desconhecido", async () => {
    const f = previewFixture();
    await expect(preview(f, "desconhecido")).rejects.toMatchObject({ code: "PROFILE_NOT_FOUND" });
    expect(f.requests).toHaveLength(0);
  });

  it.each([
    ["Clientes", "Clientes", "UNCHANGED"],
    ["Anterior", "Anterior", "SAFE_METADATA"],
    ["Clientes", "Edição humana", "LOCAL_DRIFT"],
    ["Anterior", "Outro nome", "CONFLICT"],
    ["Anterior", "Clientes", "CONFLICT"],
  ])("three way BASE=%s LOCAL=%s -> %s", async (baseName, localName, classification) => {
    const f = managedFixture();
    f.tables.business_profile_contributions[0] = contribution({ name: baseName, isDefault: false });
    f.tables.crm_pipelines[0] = pipeline(localName);
    expect(await pipelineClass(f)).toBe(classification);
    expect((await preview(f)).installation.appliedVersion).toBe("0.8.0");
  });

  it("resourceRef desaparecido vira CONFLICT, não snapshot fabricado", async () => {
    const f = managedFixture();
    f.tables.crm_pipelines = [];
    expect(await pipelineClass(f)).toBe("CONFLICT");
  });

  it.each(["managed", "drifted"])("%s participa do BASE", async (state) => {
    const f = managedFixture();
    f.tables.business_profile_contributions[0] = contribution(undefined, state);
    expect(await pipelineClass(f)).toBe("UNCHANGED");
  });

  it.each(["released", "retired"])(
    "%s continua não gerido e causa colisão sem readotar",
    async (state) => {
      const f = managedFixture();
      f.tables.business_profile_contributions[0] = contribution(undefined, state);
      const result = await preview(f);
      const change = result.plan.changes.find((c) => c.resourceKind === "pipeline")!;
      expect(change.classification).toBe("CONFLICT");
      expect(change.base).toBeNull();
      expect(change.local).toEqual({ name: "Clientes", isDefault: false });
    },
  );

  it("pipeline não gerido com mesmo nome é colisão", async () => {
    const f = previewFixture();
    f.tables.crm_pipelines.push(pipeline());
    expect(await pipelineClass(f)).toBe("CONFLICT");
  });

  it("stage não gerida colide no pipeline gerido sem adotar nem inferir hint", async () => {
    const f = managedFixture();
    f.tables.crm_stages.push(stage());
    const result = await preview(f);
    const change = result.plan.changes.find((c) => c.contributionKey === "stage.main.new")!;
    expect(change.classification).toBe("CONFLICT");
    expect(change.local).toMatchObject({ step: null, isWon: true, isLost: true });
  });

  it("field não gerido colide por key no pipeline gerido", async () => {
    const f = managedFixture();
    f.tables.business_profile_installations[0] = installed("salao-barbearia");
    f.tables.business_profile_contributions[0] = {
      ...contribution({ name: "Agendamentos", isDefault: false }),
      profile_id: "salao-barbearia",
    };
    f.tables.crm_pipelines[0] = {
      ...pipeline("Agendamentos"),
      settings: {
        fields: [{ key: "servico_desejado", label: "Local", type: "text", required: false }],
      },
    };
    const r = await preview(f, "salao-barbearia");
    expect(
      r.plan.changes.find((c) => c.contributionKey === "field.main.servico_desejado"),
    ).toMatchObject({
      classification: "CONFLICT",
      resourceRef: fieldResourceRef("p1", "servico_desejado"),
    });
  });

  it("não confunde filho de pipeline não gerido com filho TARGET", async () => {
    const f = previewFixture();
    f.tables.crm_pipelines.push(pipeline("Outro"));
    f.tables.crm_stages.push(stage());
    const local = await loadLocal(f.client, ORG_A, []);
    expect(local.find((c) => c.resourceKind === "stage")).toMatchObject({
      contributionKey: null,
      parentKey: "local-pipeline:p1",
    });
  });

  it("hint null independe de nome, posição e flags", async () => {
    const f = previewFixture();
    f.tables.crm_pipelines.push(pipeline("Outro"));
    f.tables.crm_stages.push({ ...stage(), name: "Ganhou", position: 999 });
    const local = await loadLocal(f.client, ORG_A, []);
    expect(local.find((c) => c.resourceKind === "stage")?.value).toEqual({
      name: "Ganhou",
      position: 999,
      step: null,
      isWon: true,
      isLost: true,
    });
  });

  it("hint inválido aborta sem usar null", async () => {
    const f = managedFixture();
    f.tables.crm_stages.push(stage("invalid"));
    await expect(preview(f)).rejects.toMatchObject({ code: "PREVIEW_STATE_INVALID" });
  });

  it.each([
    null,
    { fields: null },
    { fields: {} },
    { fields: [{ key: "x", type: "invalid", label: "X" }] },
  ])("fields presente inválido aborta: %j", async (settings) => {
    const f = managedFixture();
    f.tables.crm_pipelines[0] = {
      ...pipeline(),
      settings: settings === null ? { fields: null } : settings,
    };
    await expect(preview(f)).rejects.toMatchObject({ code: "PREVIEW_STATE_INVALID" });
  });

  it.each([null, {}, { fields: [] }])("settings válido vazio: %j", async (settings) => {
    const f = managedFixture();
    f.tables.crm_pipelines[0] = { ...pipeline(), settings };
    expect(await pipelineClass(f)).toBe("UNCHANGED");
  });

  it.each([
    {},
    { name: "Clientes", isDefault: "false" },
    { name: "Clientes", isDefault: false, extra: 1 },
  ])("managed_value inválido fecha BASE: %j", async (value) => {
    const f = managedFixture();
    f.tables.business_profile_contributions[0] = contribution(value);
    await expect(preview(f)).rejects.toMatchObject({ code: "PREVIEW_STATE_INVALID" });
    expect(f.requests.some((r) => r.table === "crm_pipelines")).toBe(false);
  });

  it.each([
    "business_profile_installations",
    "business_profile_contributions",
    "crm_pipelines",
    "crm_stages",
  ])("falha DB em %s aborta", async (table) => {
    const f = managedFixture();
    f.failures.add(table);
    await expect(preview(f)).rejects.toMatchObject({ code: "PREVIEW_READ_ERROR" });
  });

  it("troca de perfil não vira clean install e não carrega LOCAL", async () => {
    const f = managedFixture();
    f.tables.business_profile_installations[0] = installed("salao-barbearia");
    await expect(preview(f)).rejects.toMatchObject({ code: "PROFILE_SWITCH_NOT_SUPPORTED" });
    expect(f.requests).toHaveLength(1);
  });

  it("Org A não recebe instalação, contribuições, pipelines, stages ou fields de B", async () => {
    const f = previewFixture();
    f.tables.business_profile_installations.push({ ...installed(), organization_id: ORG_B });
    f.tables.business_profile_contributions.push({ ...contribution(), organization_id: ORG_B });
    f.tables.crm_pipelines.push({
      ...pipeline("Clientes", "b1", ORG_B),
      settings: { fields: [{ key: "secret", label: "B-secret", type: "text" }] },
    });
    f.tables.crm_stages.push({
      ...stage(),
      organization_id: ORG_B,
      pipeline_id: "b1",
      name: "B-secret",
    });
    const r = await preview(f);
    expect(r.installation.installed).toBe(false);
    expect(r.summary.safeAdd).toBe(8);
    expect(JSON.stringify(r)).not.toContain("B-secret");
    expect(
      f.requests.every((r) => r.url.searchParams.get("organization_id") === "eq." + ORG_A),
    ).toBe(true);
  });

  it("installed lê somente quatro fontes em lote, nunca operations", async () => {
    const f = managedFixture();
    await preview(f);
    expect(f.requests.map((r) => r.table).sort()).toEqual([
      "business_profile_contributions",
      "business_profile_installations",
      "crm_pipelines",
      "crm_stages",
    ]);
    expect(f.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("pagina pipelines sem perder recursos além do limite PostgREST", async () => {
    const f = previewFixture();
    for (let i = 0; i < 1001; i++) f.tables.crm_pipelines.push(pipeline("Outro", "p" + i));
    const local = await loadLocal(f.client, ORG_A, []);
    expect(local).toHaveLength(1001);
    expect(f.requests.filter((r) => r.table === "crm_pipelines")).toHaveLength(2);
  });

  it("managed stage usa parent persistido e value real; ausente continua ausente", async () => {
    const f = managedFixture();
    f.tables.business_profile_contributions.push({
      ...contribution(),
      id: "c2",
      resource_kind: "stage",
      resource_ref: "s1",
      contribution_key: "stage.main.new",
      parent_contribution_key: "pipeline.main",
      managed_value: {
        name: "Novo contato",
        step: "new",
        position: 1,
        isWon: false,
        isLost: false,
      },
    });
    f.tables.crm_stages.push({ ...stage("new"), is_won: false, is_lost: false });
    expect(
      (await preview(f)).plan.changes.find((c) => c.contributionKey === "stage.main.new")
        ?.classification,
    ).toBe("UNCHANGED");
    f.tables.crm_stages = [];
    expect(
      (await preview(f)).plan.changes.find((c) => c.contributionKey === "stage.main.new")
        ?.classification,
    ).toBe("CONFLICT");
  });
});
