import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(thisDir, "../../../.github/workflows/ci.yml");

describe("GitHub Actions CI workflow", () => {
  it("对 develop 与 master 分支的 push / pull_request 触发，并执行安装、构建、测试覆盖率校验", () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- develop");
    expect(workflow).toContain("- master");

    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run test:coverage");
  });
});
