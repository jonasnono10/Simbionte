import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, dynamic } from "@/app/api/v1/simbionte/business-profiles/[profileId]/preview/route";
import { loadAuthUser, mfaEmDivida, orgAtivaSemPortao } from "@/lib/auth/server";
import type { ActiveOrg, AuthUser, Role } from "@/lib/auth/types";
import type { SupportContext } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { installed, ORG_A, ORG_B, pipeline, previewFixture } from "./preview-fixture";

// O guard requireRole NÃO é mockado: apenas suas fontes canônicas de sessão/DB.
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  orgAtivaSemPortao: vi.fn(),
  mfaEmDivida: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

let fixture: ReturnType<typeof previewFixture>;
let user: AuthUser;
let org: ActiveOrg;
const request = (profileId = "generico", query = "", headers?: HeadersInit) =>
  GET(
    new Request(
      "http://localhost/api/v1/simbionte/business-profiles/" + profileId + "/preview" + query,
      { headers },
    ),
    { params: Promise.resolve({ profileId }) },
  );
function support(mode: "full" | "support_readonly"): SupportContext {
  return {
    id: ORG_A,
    organization_id: ORG_A,
    actor_user_id: ORG_A,
    auth_session_id: ORG_A,
    previous_organization_id: null,
    expires_at: "2099-01-01T00:00:00Z",
    name: "Org A",
    locale: "pt-BR",
    access_mode: mode,
    status: "active",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture = previewFixture();
  user = {
    id: ORG_A,
    email: "fixture@example.test",
    full_name: null,
    avatar_url: null,
    idioma: "pt-BR",
    is_platform_admin: false,
    organizations: [],
  };
  org = { orgId: ORG_A, name: "Org A", role: "manager", org_status: "active" };
  vi.mocked(loadAuthUser).mockImplementation(async () => user);
  vi.mocked(orgAtivaSemPortao).mockImplementation(async () => org);
  vi.mocked(mfaEmDivida).mockResolvedValue(false);
  vi.mocked(createClient).mockResolvedValue(fixture.client);
});
describe("GET preview com auth canônico real", () => {
  it.each<[Role, number]>([
    ["viewer", 403],
    ["agent", 403],
    ["manager", 200],
    ["admin", 200],
  ])("%s -> %i", async (role, status) => {
    fixture.auth.role = role;
    const response = await request();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (status === 403)
      expect(fixture.requests.every((r) => r.table === "fn_user_role_in_org")).toBe(true);
  });
  it("não confia no role manager do snapshot quando DB revogou", async () => {
    fixture.auth.role = "viewer";
    expect((await request()).status).toBe(403);
  });
  it("platform admin fora de suporte usa leitura canônica, sem atalho SIMBIONTE", async () => {
    user.is_platform_admin = true;
    user.platform_admin_scope = "support_readonly";
    fixture.auth.role = "viewer";
    expect((await request()).status).toBe(200);
    expect(fixture.requests.some((r) => r.table === "fn_user_role_in_org")).toBe(false);
  });
  it.each([
    ["full", "admin", 200],
    ["support_readonly", "viewer", 403],
  ] as const)("suporte %s usa role efetivo %s -> %i", async (mode, role, status) => {
    user.support = support(mode);
    fixture.auth.role = role;
    expect((await request()).status).toBe(status);
  });
  it("platform admin durante suporte read-only não bypassa role", async () => {
    user.is_platform_admin = true;
    user.support = support("support_readonly");
    fixture.auth.role = "viewer";
    expect((await request()).status).toBe(403);
  });
  it("suporte encerrado é negado antes das leituras", async () => {
    user.support = { ...support("full"), status: "expired" };
    expect((await request()).status).toBe(403);
    expect(fixture.requests).toHaveLength(0);
  });
  it("sem organização -> 403", async () => {
    vi.mocked(orgAtivaSemPortao).mockResolvedValue(null);
    expect((await request()).status).toBe(403);
    expect(fixture.requests).toHaveLength(0);
  });
  it("sem sessão -> 401", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(null);
    expect((await request()).status).toBe(401);
  });
  it("MFA pendente segue core -> 403", async () => {
    vi.mocked(mfaEmDivida).mockResolvedValue(true);
    expect((await request()).status).toBe(403);
  });
  it.each(["?organization_id=" + ORG_B, "?manifest=arbitrario"])(
    "query spoof rejeitada: %s",
    async (query) => {
      expect((await request("generico", query)).status).toBe(400);
      expect(fixture.requests).toHaveLength(0);
    },
  );
  it.each(["organization_id", "x-organization-id"])(
    "header spoof rejeitado: %s",
    async (header) => {
      expect((await request("generico", "", { [header]: ORG_B })).status).toBe(400);
    },
  );
  it("perfil válido mas desconhecido -> 404 estruturado", async () => {
    const r = await request("desconhecido");
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: { code: "not_found" } });
  });
  it("troca de profile -> 409, sem ler LOCAL", async () => {
    fixture.tables.business_profile_installations.push(installed("salao-barbearia"));
    const r = await request();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "PROFILE_SWITCH_NOT_SUPPORTED" } });
    expect(fixture.requests.filter((r) => r.method === "GET")).toHaveLength(1);
  });
  it.each(["crm_stages", "fn_user_role_in_org"])(
    "erro %s sanitizado, sem SQL/credencial",
    async (table) => {
      if (table === "fn_user_role_in_org") fixture.auth.rpcFailure = true;
      else fixture.failures.add(table);
      const r = await request();
      expect(r.status).toBe(500);
      expect(await r.text()).not.toMatch(/SQL|credential|secret|XX000/);
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toMatch(
        /SQL|credential|secret/,
      );
    },
  );
  it("shape ilegível -> 500 sanitizado", async () => {
    fixture.tables.crm_pipelines.push({ ...pipeline(), settings: { fields: null } });
    expect((await request()).status).toBe(500);
  });
  it("rota só lê Org A e nunca escreve operações ou CRM", async () => {
    fixture.tables.crm_pipelines.push({
      ...pipeline("SEGREDO B", "b1", ORG_B),
      settings: { fields: [{ key: "b", label: "SEGREDO B", type: "text" }] },
    });
    const before = structuredClone(fixture.tables);
    const r = await request();
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("SEGREDO B");
    const reads = fixture.requests.filter((r) => r.method === "GET");
    expect(reads.every((r) => r.url.searchParams.get("organization_id") === "eq." + ORG_A)).toBe(
      true,
    );
    expect(
      fixture.requests.every((r) => r.method === "GET" || r.table === "fn_user_role_in_org"),
    ).toBe(true);
    expect(fixture.tables).toEqual(before);
  });
  it("resposta inclui hash, categorias e apply false; sem cache", async () => {
    const r = await request();
    expect(await r.json()).toMatchObject({
      data: {
        profile: { id: "generico" },
        summary: { safe_add: 8 },
        plan: { plan_hash: expect.any(String), changes: expect.any(Array) },
        capabilities: { preview: true, apply: false },
      },
    });
    expect(dynamic).toBe("force-dynamic");
    expect(r.headers.get("X-Request-Id")).toBeTruthy();
  });
});
