/**
 * 从工具调用参数生成 unified diff 预览
 * 用于权限确认前展示代码改动
 */

export function buildDiff(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  if (toolName === "Edit") {
    return buildEditDiff(input);
  }
  if (toolName === "Write") {
    return buildWriteDiff(input);
  }
  return null;
}

function buildEditDiff(input: Record<string, unknown>): string | null {
  const filePath = input.file_path;
  const oldString = input.old_string;
  const newString = input.new_string;

  if (
    typeof filePath !== "string" ||
    typeof oldString !== "string" ||
    typeof newString !== "string"
  ) {
    return null;
  }

  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  // 简单 unified diff 格式
  let diff = `--- ${filePath}\n`;
  diff += `+++ ${filePath}\n`;
  diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

  for (const line of oldLines) {
    diff += `-${line}\n`;
  }
  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  return diff;
}

function buildWriteDiff(input: Record<string, unknown>): string | null {
  const filePath = input.file_path;
  const content = input.content;

  if (typeof filePath !== "string" || typeof content !== "string") {
    return null;
  }

  const lines = content.split("\n");

  let diff = `--- /dev/null\n`;
  diff += `+++ ${filePath}\n`;
  diff += `@@ -0,0 +1,${lines.length} @@\n`;

  for (const line of lines) {
    diff += `+${line}\n`;
  }

  return diff;
}
