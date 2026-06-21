import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("responsive CSS", () => {
  it("uses the visual viewport height variable on mobile so the composer stays above the keyboard", () => {
    const css = readFileSync(resolve(__dirname, "responsive.css"), "utf8");

    expect(css).toContain("--coderelay-visual-viewport-height");
    expect(css).toContain("height: var(--coderelay-visual-viewport-height, 100dvh)");
  });

  it("keeps all essential mobile composer controls in the same visible row", () => {
    const css = readFileSync(resolve(__dirname, "responsive.css"), "utf8");

    expect(css).toContain("grid-template-areas:");
    expect(css).toContain('"image input mode send"');
    expect(css).not.toContain('"input input input"');
    expect(css).not.toContain('"image mode send"');
    expect(css).toContain("grid-area: image");
    expect(css).toContain("grid-area: input");
    expect(css).toContain("grid-area: mode");
    expect(css).toContain("grid-area: send");
    expect(css).toContain("padding-bottom: calc(0.625rem + env(safe-area-inset-bottom, 0px))");
  });

  it("只把移动端模式触发按钮压缩成图标,不影响展开后的菜单项文字", () => {
    const css = readFileSync(resolve(__dirname, "responsive.css"), "utf8");

    expect(css).toContain(".composer-mode .mode-menu-trigger");
    expect(css).toContain("width: 44px !important");
    expect(css).toContain(".composer-mode .mode-menu-trigger span:nth-child(2)");
    expect(css).toContain(".composer-mode .mode-menu-trigger span:nth-child(3)");
    expect(css).toContain(".composer-mode .mode-menu-panel");
    expect(css).toContain(".composer-mode .mode-menu-item");
    expect(css).not.toContain(".composer-mode button {");
    expect(css).not.toContain(".composer-mode button span:nth-child");
  });
});
