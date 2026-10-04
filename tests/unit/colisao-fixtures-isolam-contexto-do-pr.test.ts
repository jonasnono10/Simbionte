import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("colisão de migrations: o harness controla seu contexto GitHub", () => {
  it("PR externo #7 não apaga o #7 fictício nem enfraquece colisões reais", () => {
    // F2.3C.0: 9/106 falhavam só porque o workflow real também era o PR #7.
    // Atribuições no shell chegam ao Linux inclusive ao executar via Bash/WSL.
    const result = spawnSync("bash", ["-c", [
      "GITHUB_REF=refs/pull/7/merge",
      "GITHUB_HEAD_REF=fix/pr-externo",
      "GITHUB_BASE_REF=develop",
      "GITHUB_EVENT_NAME=pull_request",
      "GITHUB_EVENT_PATH=/evento/externo/nao-deve-ser-lido.json",
      "bash tests/shell/colisao-de-migration.test.sh",
    ].join(" ")], { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 });

    const output = result.stdout + result.stderr;
    expect(result.error, output).toBeUndefined();
    expect(result.status, output).toBe(0);
    expect(output).toContain("colisao-de-migration: 111 casos, todos verdes");
    expect(output).not.toContain("  ✗ ");
    expect(output).toContain("✓ NNNN já tomado na base reprova");
    expect(output).toContain("✓ NNNN livre passa");
    expect(output).toContain("✓ a ref sintética exclui somente o próprio PR");
    expect(output).toContain("✓ outro PR continua medido no contexto CI");
  }, 65_000);
});
