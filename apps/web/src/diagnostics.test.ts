import { vi } from "vitest";
import type { CodeRelayTransport } from "@coderelay/transport";
import * as diagnostics from "./diagnostics";
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

  test("注入 transport 时通过 transport 上报诊断日志", () => {
    const transport: CodeRelayTransport = {
      request: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
    };
    const setter = (diagnostics as unknown as {
      setDiagnosticsTransport?: (transport: CodeRelayTransport | null) => void;
    }).setDiagnosticsTransport;
    expect(setter).toBeTypeOf("function");
    setter?.(transport);

    clientLog("transport.log", { runId: "run-2" });

    expect(transport.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/debug/client-log",
      body: expect.objectContaining({
        event: "transport.log",
        runId: "run-2",
      }),
      keepalive: true,
    });

    setter?.(null);
  });

  test("没有真实 HTTP token 时不通过 HTTP fallback 上报诊断日志", () => {
    Storage.prototype.getItem = vi.fn(() => null);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);

    clientLog("p2p.connecting", { runId: "run-pending" });

    expect(console.debug).toHaveBeenCalledWith(
      "[cc-web:client]",
      expect.objectContaining({ event: "p2p.connecting" })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
