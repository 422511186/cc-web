import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(thisDir, "../../../");

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8"));
}

describe("coverage configuration", () => {
  it("root 与各 workspace 都应提供 test:coverage 脚本", () => {
    const rootPkg = readJson("package.json");
    const sharedPkg = readJson("packages/shared/package.json");
    const serverPkg = readJson("packages/server/package.json");
    const webPkg = readJson("packages/web/package.json");

    expect(rootPkg.scripts["test:coverage"]).toBeTruthy();
    expect(sharedPkg.scripts["test:coverage"]).toBeTruthy();
    expect(serverPkg.scripts["test:coverage"]).toBeTruthy();
    expect(webPkg.scripts["test:coverage"]).toBeTruthy();
  });

  it("shared / server / web 的 Vitest 配置都应声明 v8 coverage 与 thresholds", () => {
    const configs = [
      "packages/shared/vitest.config.ts",
      "packages/server/vitest.config.ts",
      "packages/web/vitest.config.ts",
    ];

    for (const config of configs) {
      const fullPath = resolve(repoRoot, config);
      expect(existsSync(fullPath)).toBe(true);

      const content = readFileSync(fullPath, "utf8");
      expect(content).toContain("provider: 'v8'");
      expect(content).toContain("thresholds");
    }
  });

  it("不应跟踪已被 .gitignore 忽略的依赖或构建产物", () => {
    const ignoredTrackedFiles = execFileSync(
      "git",
      ["ls-files", "-ci", "--exclude-standard"],
      { cwd: repoRoot, encoding: "utf8" }
    )
      .split(/\r?\n/)
      .filter(Boolean);

    expect(ignoredTrackedFiles).toEqual([]);
  });
});
