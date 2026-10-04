import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}
describe("cerca read-only do preview", () => {
  it("runtime não importa admin/service role e não chama escrita nem RPC paralela", () => {
    const runtime = [
      ...files("lib/simbionte/business-profiles/preview"),
      ...files("app/api/v1/simbionte/business-profiles"),
    ];
    expect(runtime.length).toBeGreaterThan(3);
    const violations: string[] = [];
    for (const file of runtime) {
      const source = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["insert", "update", "delete", "upsert", "rpc"].includes(node.expression.name.text)
        ) {
          violations.push(file + ": " + node.expression.name.text);
        }
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          /supabase\/(admin|browser)|supabase-js/.test(node.moduleSpecifier.text)
        ) {
          violations.push(file + ": import " + node.moduleSpecifier.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      expect(source).not.toMatch(/service_role|createAdminClient|business_profile_operations/);
      expect(source).not.toMatch(/as any|as unknown as|as ProfileResourceSnapshot/);
    }
    expect(violations).toEqual([]);
  });
  it("rota exporta GET, nunca um handler mutante", () => {
    const source = readFileSync(
      "app/api/v1/simbionte/business-profiles/[profileId]/preview/route.ts",
      "utf8",
    );
    expect(source).toContain('requireRole("manager"');
    expect(source).toContain('allowPlatformAdmin: "leitura"');
    expect(source).not.toMatch(/export (?:async )?function (POST|PUT|PATCH|DELETE)/);
  });
});
