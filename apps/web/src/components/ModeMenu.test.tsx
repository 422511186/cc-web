import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ModeMenu } from "./ModeMenu";

describe("ModeMenu", () => {
  test("移动端压缩样式只应作用在触发按钮,菜单项仍保留可读文本", () => {
    render(<ModeMenu mode="default" onModeChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /Ask before edits/i });
    expect(trigger).toHaveClass("mode-menu-trigger");

    fireEvent.click(trigger);

    expect(screen.getByRole("menu", { name: "Modes" })).toHaveClass("mode-menu-panel");

    const planItem = screen.getByRole("menuitemradio", { name: /Plan mode/i });
    expect(planItem).toHaveClass("mode-menu-item");
    expect(screen.getByText("Claude will explore and present a plan before editing")).toBeVisible();
  });
});
