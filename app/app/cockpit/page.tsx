import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CockpitView } from "@/components/simbionte/cockpit/CockpitView";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { carregarCockpit } from "@/lib/simbionte/cockpit/read-model";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cockpit" };

export default async function CockpitPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const client = await createClient();
  const model = await carregarCockpit({
    client,
    organizationId: activeOrg.orgId,
    role: activeOrg.role,
  });

  return <CockpitView model={model} idioma={user.idioma} timezone={user.timezone ?? "UTC"} />;
}
