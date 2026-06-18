import { describe, expect, it, vi } from "vitest";

async function loadApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./p2pHttpBridge.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function expectApiFunction<T extends (...args: any[]) => any>(name: string): Promise<T> {
  const api = await loadApi();
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("createLocalHttpP2PBridgeHandlers", () => {
  it("forwards P2P requests to the local /api HTTP surface with auth", async () => {
    const createLocalHttpP2PBridgeHandlers = await expectApiFunction("createLocalHttpP2PBridgeHandlers");
    const fetchFn = vi.fn(async () => jsonResponse(200, { runId: "run-1" }));
    const handlers = createLocalHttpP2PBridgeHandlers({
      baseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token",
      fetchFn,
    });

    await expect(
      handlers.handleRequest({
        id: "req-1",
        method: "POST",
        path: "/sessions/new",
        body: { cwd: "C:/work" },
        headers: { "X-CodeRelay-Test": "yes" },
      }),
    ).resolves.toEqual({ status: 200, body: { runId: "run-1" } });
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:3002/api/sessions/new", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "X-CodeRelay-Test": "yes",
      },
      body: JSON.stringify({ cwd: "C:/work" }),
      signal: undefined,
    });
  });

  it("preserves 204 responses without forcing a JSON body", async () => {
    const createLocalHttpP2PBridgeHandlers = await expectApiFunction("createLocalHttpP2PBridgeHandlers");
    const handlers = createLocalHttpP2PBridgeHandlers({
      baseUrl: "http://127.0.0.1:3002/api",
      fetchFn: vi.fn(async () => ({ ok: true, status: 204 })),
    });

    await expect(
      handlers.handleRequest({
        id: "req-1",
        method: "DELETE",
        path: "/sessions/run-1",
      }),
    ).resolves.toEqual({ status: 204, body: undefined });
  });

  it("bridges local SSE frames into P2P stream sink events and aborts on close", async () => {
    const createLocalHttpP2PBridgeHandlers = await expectApiFunction("createLocalHttpP2PBridgeHandlers");
    let capturedSignal: AbortSignal | undefined;
    const fetchFn = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      capturedSignal = init.signal;
      return sseResponse([
        ": connected\n\n",
        'data: {"type":"status","state":"executing"}\n\n',
        'event: session-update\ndata: {"projectId":"p1","sessionId":"s1"}\n\n',
      ]);
    });
    const handlers = createLocalHttpP2PBridgeHandlers({
      baseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token",
      fetchFn,
    });
    const opened = vi.fn();
    const events: unknown[] = [];
    const errors = vi.fn();
    const closed = vi.fn();

    const handle = await handlers.handleStream(
      { streamId: "stream-1", path: "/sessions/run-1/stream" },
      {
        open: opened,
        event: (event: unknown) => events.push(event),
        error: errors,
        close: closed,
      },
    );

    await waitFor(() => events.length === 2);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "status", state: "executing" },
      { projectId: "p1", sessionId: "s1" },
    ]);
    expect(errors).not.toHaveBeenCalled();

    handle.close();

    expect(capturedSignal?.aborted).toBe(true);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function sseResponse(chunks: string[]): Response {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  } as Response;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}
