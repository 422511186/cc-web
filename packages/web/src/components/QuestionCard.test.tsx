import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import type { QuestionPrompt } from "@cc-web/shared";

describe("QuestionCard", () => {
  const mockPrompt: QuestionPrompt = {
    kind: "question",
    id: "q-1",
    questions: [
      {
        header: "选择问题",
        question: "你想做什么?",
        multiSelect: false,
        options: [
          { label: "选项A", description: "描述A" },
          { label: "选项B", description: "描述B" },
        ],
      },
    ],
  };

  test("点击提交后按钮被禁用,onAnswer 只调用1次", () => {
    const onAnswer = vi.fn();

    render(<QuestionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    // 选择一个选项使提交按钮可用
    const optionA = screen.getByText("选项A");
    fireEvent.click(optionA);

    const submitBtn = screen.getByText("提交");
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({
      kind: "question",
      id: "q-1",
      answers: [["选项A"]],
    });
    expect(submitBtn).toBeDisabled();
  });

  test("快速双击提交按钮,onAnswer 仍只调用1次", () => {
    const onAnswer = vi.fn();

    render(<QuestionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    // 选择一个选项
    const optionA = screen.getByText("选项A");
    fireEvent.click(optionA);

    const submitBtn = screen.getByText("提交");

    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  test("prompt.id 变化时应重置选择与提交状态,新问题可重新作答", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<QuestionCard prompt={mockPrompt} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText("选项A"));
    fireEvent.click(screen.getByText("提交"));
    expect(screen.getByText("提交")).toBeDisabled();

    const nextPrompt: QuestionPrompt = {
      kind: "question",
      id: "q-2",
      questions: [
        {
          header: "第二题",
          question: "这次选哪个?",
          multiSelect: false,
          options: [
            { label: "选项C", description: "描述C" },
            { label: "选项D", description: "描述D" },
          ],
        },
      ],
    };

    rerender(<QuestionCard prompt={nextPrompt} onAnswer={onAnswer} />);

    const submitBtn = screen.getByText("提交");
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByText("选项D"));
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(onAnswer).toHaveBeenLastCalledWith({
      kind: "question",
      id: "q-2",
      answers: [["选项D"]],
    });
  });
});
