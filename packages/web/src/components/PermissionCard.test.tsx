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
});
