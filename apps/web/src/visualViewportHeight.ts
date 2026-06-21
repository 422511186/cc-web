const VISUAL_VIEWPORT_HEIGHT_VAR = "--coderelay-visual-viewport-height";

export function installVisualViewportHeightVar(
  root: HTMLElement = document.documentElement,
  viewport: VisualViewport | null | undefined = window.visualViewport,
): () => void {
  const update = () => {
    const height = viewport?.height ?? window.innerHeight;
    if (Number.isFinite(height) && height > 0) {
      root.style.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${height}px`);
    }
  };

  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);

  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  };
}
