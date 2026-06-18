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

const workspaces = [
  {
    path: "apps/host",
    packageName: "@coderelay/host",
  },
  {
    path: "apps/web",
    packageName: "@coderelay/web",
  },
  {
    path: "apps/signal",
    packageName: "@coderelay/signal",
  },
  {
    path: "packages/shared",
    packageName: "@coderelay/shared",
  },
  {
    path: "packages/transport",
    packageName: "@coderelay/transport",
  },
  {
    path: "packages/p2p-core",
    packageName: "@coderelay/p2p-core",
  },
  {
    path: "packages/test-utils",
    packageName: "@coderelay/test-utils",
  },
];

describe("coverage configuration", () => {
  it("root 与各 workspace 都应提供 test:coverage 脚本", () => {
    const rootPkg = readJson("package.json");
    expect(rootPkg.name).toBe("coderelay");
    expect(rootPkg.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(rootPkg.scripts["test:coverage"]).toBeTruthy();

    for (const workspace of workspaces) {
      const pkg = readJson(`${workspace.path}/package.json`);
      expect(pkg.name).toBe(workspace.packageName);
      expect(pkg.scripts["test:coverage"]).toBeTruthy();
    }
  });

  it("所有 CodeRelay workspace 的 Vitest 配置都应声明 v8 coverage 与 thresholds", () => {
    for (const workspace of workspaces) {
      const fullPath = resolve(repoRoot, workspace.path, "vitest.config.ts");
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
