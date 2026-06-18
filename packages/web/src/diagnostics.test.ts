import { vi } from "vitest";
import { clientLog } from "./diagnostics";

describe("client diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Storage.prototype.getItem = vi.fn((key) => key === "authToken" ? "test-token" : null);
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  test("clientLog 同时写 console 并上报到后端诊断接口", () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);

    clientLog("app.session-select", {
      runId: "run-1",
      sessionId: "s1",
      projectId: "p1",
    });

    expect(console.debug).toHaveBeenCalledWith(
      "[cc-web:client]",
      expect.objectContaining({
        event: "app.session-select",
        runId: "run-1",
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/debug/client-log",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining("app.session-select"),
        keepalive: true,
      })
    );
  });
});
