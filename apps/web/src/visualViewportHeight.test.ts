import { installVisualViewportHeightVar } from "./visualViewportHeight";

describe("installVisualViewportHeightVar", () => {
  it("syncs the CSS height variable from visualViewport and updates on resize", () => {
    const root = document.createElement("div");
    let resizeListener: (() => void) | undefined;
    const viewport = {
      height: 520,
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "resize") resizeListener = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as VisualViewport;

    const cleanup = installVisualViewportHeightVar(root, viewport);

    expect(root.style.getPropertyValue("--coderelay-visual-viewport-height")).toBe("520px");
    (viewport as unknown as { height: number }).height = 390;
    resizeListener?.();
    expect(root.style.getPropertyValue("--coderelay-visual-viewport-height")).toBe("390px");

    cleanup();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(viewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
