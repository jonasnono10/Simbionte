import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

export const ORG_A = "00000000-0000-4000-8000-000000000001";
export const ORG_B = "00000000-0000-4000-8000-000000000002";

export function previewFixture() {
  const tables: Record<
    | "business_profile_installations"
    | "business_profile_contributions"
    | "crm_pipelines"
    | "crm_stages",
    Record<string, unknown>[]
  > = {
    business_profile_installations: [],
    business_profile_contributions: [],
    crm_pipelines: [],
    crm_stages: [],
  };
  const requests: { method: string; table: string; url: URL }[] = [];
  const failures = new Set<string>();
  const auth = { role: "manager", rpcFailure: false };
  const paging = { omitCount: false, cap: 1000 };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const table = url.pathname.split("/").at(-1)!;
    requests.push({ method, table, url });
    // Única RPC permitida: leitura canônica do papel, usada pelo guard real.
    if (url.pathname === "/rest/v1/rpc/fn_user_role_in_org" && method === "POST") {
      return new Response(
        JSON.stringify(
          auth.rpcFailure ? { message: "SQL credential secret", code: "XX000" } : auth.role,
        ),
        {
          status: auth.rpcFailure ? 500 : 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (method !== "GET") throw new Error("WRITE BLOCKED: " + method);
    if (failures.has(table))
      return new Response(JSON.stringify({ message: "SQL credential secret", code: "XX000" }), {
        status: 500,
      });
    const source = Object.entries(tables).find(([name]) => name === table)?.[1];
    if (!source) throw new Error("Unexpected table: " + table);
    const rows = source.filter((row) =>
      [...url.searchParams].every(
        ([key, value]) => !value.startsWith("eq.") || row[key] === value.slice(3),
      ),
    );
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? total);
    const selected = (url.searchParams.get("select") ?? "").split(",");
    const page = rows
      .slice(offset, offset + Math.min(limit, paging.cap))
      .map((row) => Object.fromEntries(selected.map((key) => [key, row[key]])));
    return new Response(JSON.stringify(page), {
      headers: {
        "Content-Type": "application/json",
        ...(!paging.omitCount
          ? { "Content-Range": `${offset}-${offset + page.length - 1}/${total}` }
          : {}),
      },
    });
  };
  const client = createClient<Database>("http://127.0.0.1:54321", "fixture-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, tables, requests, failures, auth, paging };
}

export function installed(profileId = "generico") {
  return {
    organization_id: ORG_A,
    profile_id: profileId,
    applied_version: "0.8.0",
    status: "active",
    revision: 2,
  };
}
export function pipeline(name = "Clientes", id = "p1", org = ORG_A) {
  return { id, organization_id: org, name, is_default: false, settings: null };
}
export function contribution(
  value: unknown = { name: "Clientes", isDefault: false },
  state = "managed",
) {
  return {
    id: "c1",
    organization_id: ORG_A,
    profile_id: "generico",
    contribution_key: "pipeline.main",
    resource_kind: "pipeline",
    resource_ref: "p1",
    parent_contribution_key: null,
    managed_value: value,
    state,
  };
}
