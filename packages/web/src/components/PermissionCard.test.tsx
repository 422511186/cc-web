import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { PermissionCard } from "./PermissionCard";
import type { PermissionPrompt } from "@cc-web/shared";

describe("PermissionCard", () => {
  const mockPrompt: PermissionPrompt = {
    kind: "permission",
    id: "perm-1",
    title: "允许执行命令?",
    detail: "rm -rf node_modules",
  };

  test("点击允许后,允许/拒绝按钮都被禁用,onAnswer 只调用1次", () => {
    const onAnswer = vi.fn();

    render(<PermissionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    const allowBtn = screen.getByText("✓ 允许");
    const denyBtn = screen.getByText("✗ 拒绝");

    fireEvent.click(allowBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "permission",
      id: "perm-1",
      decision: "allow",
    });
    expect(allowBtn).toBeDisabled();
    expect(denyBtn).toBeDisabled();
  });

  test("快速双击允许按钮,onAnswer 仍只调用1次", () => {
    const onAnswer = vi.fn();

    render(<PermissionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    const allowBtn = screen.getByText("✓ 允许");

    fireEvent.click(allowBtn);
    fireEvent.click(allowBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  test("prompt.id 变化时应重置已回答状态,新权限卡片可继续作答", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<PermissionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText("✓ 允许"));
    expect(screen.getByText("✓ 允许")).toBeDisabled();

    const nextPrompt: PermissionPrompt = {
      kind: "permission",
      id: "perm-2",
      title: "允许删除缓存?",
      detail: "rm -rf .cache",
    };

    rerender(<PermissionCard prompt={nextPrompt} onAnswer={onAnswer} />);

    const denyBtn = screen.getByText("✗ 拒绝");
    expect(screen.getByText("✓ 允许")).not.toBeDisabled();
    expect(denyBtn).not.toBeDisabled();

    fireEvent.click(denyBtn);
    expect(onAnswer).toHaveBeenLastCalledWith({
      kind: "permission",
      id: "perm-2",
      decision: "deny",
    });
  });

  test("显示 diff 预览(如果有)", () => {
    const promptWithDiff: PermissionPrompt = {
      kind: "permission",
      id: "p1",
      toolName: "Edit",
      title: "Claude wants to edit app.ts",
      detail: "/project/app.ts",
      diff: `--- /project/app.ts
+++ /project/app.ts
@@ -1,3 +1,3 @@
 function hello() {
-  console.log('hi');
+  console.log('hello world');
 }`,
    };

    const onAnswer = vi.fn();
    render(<PermissionCard prompt={promptWithDiff} onAnswer={onAnswer} />);

    // 应显示标题和详情
    expect(screen.getByText("Claude wants to edit app.ts")).toBeInTheDocument();
    expect(screen.getByText("/project/app.ts")).toBeInTheDocument();

    // 应显示 diff 预览
    expect(screen.getByText(/console.log\('hi'\)/)).toBeInTheDocument();
    expect(screen.getByText(/console.log\('hello world'\)/)).toBeInTheDocument();
  });

  test("无 diff 时不显示预览区域", () => {
    const onAnswer = vi.fn();
    const { container } = render(<PermissionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    // 不应有 diff-preview 元素
    expect(container.querySelector(".diff-preview")).not.toBeInTheDocument();
  });
});
