import { describe, expectTypeOf, it } from "vitest";

import type { Database, Json } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];
type Installations = Tables["business_profile_installations"];
type Contributions = Tables["business_profile_contributions"];
type Operations = Tables["business_profile_operations"];

// expectTypeOf é verificado por pnpm typecheck (inclui tests/**), não pelo runtime.
// Origem: Supabase CLI 2.119.0 / baseline.sql / probe F2.3C.1, run 37210494125.
describe("contratos gerados das tabelas Business Profile", () => {
  it("mantém a instalação e o vínculo único com a organização", () => {
    expectTypeOf<Installations["Row"]["revision"]>().toEqualTypeOf<number>();
    expectTypeOf<Installations["Row"]["status"]>().toEqualTypeOf<string>();
    expectTypeOf<Installations["Relationships"][0]["isOneToOne"]>().toEqualTypeOf<true>();
  });

  it("preserva referências opacas, JSON não nulo e parent opcional", () => {
    expectTypeOf<Contributions["Row"]["resource_ref"]>().toEqualTypeOf<string>();
    expectTypeOf<Contributions["Row"]["managed_value"]>().toEqualTypeOf<NonNullable<Json>>();
    expectTypeOf<Contributions["Row"]["parent_contribution_key"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Contributions["Relationships"][1]["columns"]>().toEqualTypeOf<
      ["organization_id", "profile_id", "parent_contribution_key"]
    >();
    expectTypeOf<Contributions["Relationships"][1]["referencedColumns"]>().toEqualTypeOf<
      ["organization_id", "profile_id", "contribution_key"]
    >();
  });

  it("preserva o snapshot não nulo e os campos anuláveis da operação", () => {
    expectTypeOf<Operations["Row"]["manifest_snapshot"]>().toEqualTypeOf<NonNullable<Json>>();
    expectTypeOf<Operations["Row"]["result"]>().toEqualTypeOf<Json | null>();
    expectTypeOf<Operations["Row"]["actor_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Operations["Row"]["finished_at"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Operations["Row"]["operation_type"]>().toEqualTypeOf<string>();
  });
});
