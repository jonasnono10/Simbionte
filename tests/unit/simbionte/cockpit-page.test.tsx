import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "00000000-0000-4000-8000-0000000000c0";
const estado = vi.hoisted(() => ({
  role: "viewer",
  platform: false,
  temOrg: true,
  support: null as null | "full" | "read_only",
}));
const redirect = vi.hoisted(() =>
  vi.fn((destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  }),
);
const carregarCockpit = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({ nome: "client-da-sessao" }));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: async () => ({
    id: "user-1",
    idioma: "pt-BR",
    timezone: "America/Manaus",
    is_platform_admin: estado.platform,
    support:
      estado.support === null
        ? null
        : {
            access_mode: estado.support,
            organization_id: ORG,
            name: "Org em suporte",
            status: "active",
          },
  }),
  resolveActiveOrg: async () =>
    estado.temOrg
      ? {
          orgId: ORG,
          name: estado.support ? "Org em suporte" : "Org",
          role:
            estado.support === "full"
              ? "admin"
              : estado.support === "read_only"
                ? "viewer"
                : estado.role,
        }
      : null,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/simbionte/cockpit/read-model", () => ({ carregarCockpit }));

import CockpitPage from "@/app/app/cockpit/page";

beforeEach(() => {
  estado.role = "viewer";
  estado.platform = false;
  estado.temOrg = true;
  estado.support = null;
  redirect.mockClear();
  carregarCockpit.mockReset();
  carregarCockpit.mockResolvedValue({ gerado_em: "2026-09-17T12:00:00.000Z" });
});

describe("autorização da página do Cockpit", () => {
  it("recusa papel abaixo de manager antes de consultar dados", async () => {
    await expect(CockpitPage()).rejects.toThrow("REDIRECT:/403");
    expect(carregarCockpit).not.toHaveBeenCalled();
  });

  it("manager usa a organização ativa resolvida no servidor", async () => {
    estado.role = "manager";
    const page = await CockpitPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(carregarCockpit).toHaveBeenCalledWith({
      client,
      organizationId: ORG,
      role: "manager",
    });
    expect(page.props).toMatchObject({ idioma: "pt-BR", timezone: "America/Manaus" });
  });

  it("admin continua compatível com o gate manager", async () => {
    estado.role = "admin";
    await CockpitPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(carregarCockpit).toHaveBeenCalledWith({
      client,
      organizationId: ORG,
      role: "admin",
    });
  });

  it("platform admin fora de suporte usa o bypass canônico do rank", async () => {
    estado.platform = true;
    estado.role = "viewer";
    await CockpitPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(carregarCockpit).toHaveBeenCalledWith({
      client,
      organizationId: ORG,
      role: "viewer",
    });
  });

  it("suporte full entra com o papel admin resolvido pelo contexto", async () => {
    estado.platform = true;
    estado.support = "full";
    await CockpitPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(carregarCockpit).toHaveBeenCalledWith({
      client,
      organizationId: ORG,
      role: "admin",
    });
  });

  it("suporte read-only é recusado", async () => {
    estado.platform = true;
    estado.support = "read_only";

    await expect(CockpitPage()).rejects.toThrow("REDIRECT:/403");
    expect(carregarCockpit).not.toHaveBeenCalled();
  });

  it("platform admin durante suporte não usa o bypass transversal", async () => {
    estado.platform = true;
    estado.support = "read_only";
    estado.role = "admin";

    await expect(CockpitPage()).rejects.toThrow("REDIRECT:/403");
    expect(carregarCockpit).not.toHaveBeenCalled();
  });

  it("sem organização ativa volta ao ponto de entrada", async () => {
    estado.temOrg = false;
    await expect(CockpitPage()).rejects.toThrow("REDIRECT:/app");
    expect(carregarCockpit).not.toHaveBeenCalled();
  });
});
