import { describe, expect, it } from "vitest";

import { searchable, sidebarGroups } from "@/lib/navigation/registry";

const hrefsDoSidebar = (role: "viewer" | "agent" | "manager" | "admin") =>
  sidebarGroups(false, role).flatMap((grupo) => grupo.items.map((item) => item.href));

const hrefsDaBusca = (role: "viewer" | "agent" | "manager" | "admin") =>
  searchable(false, role).map((destino) => destino.href);

describe("navegação do Cockpit", () => {
  it("preserva o Cockpit fora da lista diária de manager e admin", () => {
    expect(hrefsDoSidebar("manager")).not.toContain("/app/cockpit");
    expect(hrefsDoSidebar("admin")).not.toContain("/app/cockpit");
  });

  it("mantém o Cockpit descobrível pelo command palette somente para manager e admin", () => {
    expect(hrefsDaBusca("manager")).toContain("/app/cockpit");
    expect(hrefsDaBusca("admin")).toContain("/app/cockpit");
    expect(hrefsDaBusca("viewer")).not.toContain("/app/cockpit");
    expect(hrefsDaBusca("agent")).not.toContain("/app/cockpit");
  });
});
