import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { PlanCard } from "./PlanCard";
import type { PlanPrompt } from "@cc-web/shared";

describe("PlanCard", () => {
  const mockPrompt: PlanPrompt = {
    kind: "plan",
    id: "plan-1",
    plan: "1. 创建新文件\n2. 修改配置\n3. 运行测试",
  };

  test("点击批准后,批准/拒绝按钮都被禁用,onAnswer 只调用1次", () => {
    const onAnswer = vi.fn();

    render(<PlanCard prompt={mockPrompt} onAnswer={onAnswer} />);

    const approveBtn = screen.getByText("批准计划");
    const rejectBtn = screen.getByText("拒绝");

    fireEvent.click(approveBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "plan",
      id: "plan-1",
      decision: "approve",
    });
    expect(approveBtn).toBeDisabled();
    expect(rejectBtn).toBeDisabled();
  });

  test("快速双击批准按钮,onAnswer 仍只调用1次", () => {
    const onAnswer = vi.fn();

    render(<PlanCard prompt={mockPrompt} onAnswer={onAnswer} />);

    const approveBtn = screen.getByText("批准计划");

    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
