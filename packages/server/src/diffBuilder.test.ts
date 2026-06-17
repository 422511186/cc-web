import { describe, it, expect } from "vitest";
import { buildDiff } from "./diffBuilder.js";

describe("buildDiff", () => {
  it("Edit 工具:从 old_string/new_string 生成 unified diff", () => {
    const input = {
      file_path: "/project/src/app.ts",
      old_string: "function hello() {\n  console.log('hi');\n}",
      new_string: "function hello() {\n  console.log('hello world');\n}",
    };

    const diff = buildDiff("Edit", input);

    expect(diff).toContain("--- /project/src/app.ts");
    expect(diff).toContain("+++ /project/src/app.ts");
    expect(diff).toContain("-  console.log('hi');");
    expect(diff).toContain("+  console.log('hello world');");
  });

  it("Write 工具:新建文件时生成 diff(全为新增行)", () => {
    const input = {
      file_path: "/project/new.ts",
      content: "export const VERSION = '1.0.0';",
    };

    const diff = buildDiff("Write", input);

    expect(diff).toContain("--- /dev/null");
    expect(diff).toContain("+++ /project/new.ts");
    expect(diff).toContain("+export const VERSION = '1.0.0';");
  });

  it("非 Edit/Write 工具返回 null(不生成 diff)", () => {
    const input = { command: "npm test" };
    const diff = buildDiff("Bash", input);
    expect(diff).toBeNull();
  });

  it("Edit 工具缺少必需参数时返回 null", () => {
    const input = { file_path: "/test.ts" }; // 缺少 old_string/new_string
    const diff = buildDiff("Edit", input);
    expect(diff).toBeNull();
  });
});
