import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Guarda local, sem criar infraestrutura nova de lint para uma fundação ainda pura. */
describe("boundary F2.3A", () => {
  it("não importa serviços nem contém portas de escrita", () => {
    const folder = join(process.cwd(), "lib/simbionte/business-profiles");
    const files = readdirSync(folder).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = readFileSync(join(folder, file), "utf8");
      expect(source, file).not.toMatch(/(?:from|import\()\s*["'`]@\/lib\/(?:supabase|auth|api|agent-engine|extensions|onboarding|pipelines)\//);
      expect(source, file).not.toMatch(/\b(?:fetch|process\.env|Date\.now|new Date|randomUUID|crypto\.randomUUID)\s*\(/);
    }
  });
});
