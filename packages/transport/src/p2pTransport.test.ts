import { describe, expect, it, vi } from "vitest";
import * as transport from "./index.js";

const api = transport as Record<string, unknown>;

function expectApiFunction<T extends (...args: any[]) => any>(name: string): T {
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("P2PTransport", () => {
  it("sends request envelopes through a P2P bridge and resolves the response body", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const link = createMemoryLink();
    const seenRequests: unknown[] = [];
    createP2PBridge(link.host, {
      handleRequest: async (request: unknown) => {
        seenRequests.push(request);
        return { status: 200, body: { projects: [{ id: "p1" }] } };
      },
    });
    const client = new P2PTransport({ port: link.client });

    await expect(client.request({ method: "GET", path: "/projects" })).resolves.toEqual({
      projects: [{ id: "p1" }],
    });
    expect(seenRequests).toEqual([
      {
        id: expect.any(String),
        method: "GET",
        path: "/projects",
        body: undefined,
        headers: undefined,
      },
    ]);
  });

  it("maps non-2xx bridge responses to TransportError with status", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const TransportError = expectApiFunction("TransportError");
    const link = createMemoryLink();
    createP2PBridge(link.host, {
      handleRequest: async () => ({ status: 404, body: { error: "missing" } }),
    });
    const client = new P2PTransport({ port: link.client });

    await expect(client.request({ method: "GET", path: "/missing" })).rejects.toMatchObject({
      name: "TransportError",
      message: "missing",
      status: 404,
    });
    expect(TransportError).toBeDefined();
  });

  it("opens a P2P stream, emits events, and closes the remote stream handle", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const link = createMemoryLink();
    const closeRemoteStream = vi.fn();
    createP2PBridge(link.host, {
      handleRequest: async () => ({ status: 204 }),
      handleStream: (request: { path: string }, sink: any) => {
        expect(request.path).toBe("/sessions/run-1/stream");
        sink.open();
        sink.event({ type: "status", state: "executing" });
        return { close: closeRemoteStream };
      },
    });
    const client = new P2PTransport({ port: link.client });
    const onOpen = vi.fn();
    const onEvent = vi.fn();

    const stream = client.subscribe({
      path: "/sessions/run-1/stream",
      onOpen,
      onEvent,
    });

    await waitFor(() => onEvent.mock.calls.length === 1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: "status", state: "executing" });

    stream.close();

    await waitFor(() => closeRemoteStream.mock.calls.length === 1);
  });

  it("reuses one P2P port while switching logical streams", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const link = createMemoryLink();
    const openedPaths: string[] = [];
    createP2PBridge(link.host, {
      handleRequest: async () => ({ status: 204 }),
      handleStream: (request: { path: string }, sink: any) => {
        openedPaths.push(request.path);
        sink.open();
        return { close: () => undefined };
      },
    });
    const client = new P2PTransport({ port: link.client });

    const first = client.subscribe({ path: "/sessions/run-a/stream", onEvent: vi.fn() });
    first.close();
    const second = client.subscribe({ path: "/sessions/run-b/stream", onEvent: vi.fn() });
    second.close();

    await waitFor(() => openedPaths.length === 2);
    expect(openedPaths).toEqual(["/sessions/run-a/stream", "/sessions/run-b/stream"]);
    expect(link.client.sentCount).toBeGreaterThanOrEqual(4);
    expect(link.connectionId).toBe("memory-link-1");
  });
});

interface MemoryPort {
  readonly sentCount: number;
  send(message: string): void;
  addMessageListener(listener: (message: string) => void): () => void;
}

function createMemoryLink(): { readonly connectionId: string; readonly client: MemoryPort; readonly host: MemoryPort } {
  let clientSentCount = 0;
  let hostSentCount = 0;
  const clientListeners = new Set<(message: string) => void>();
  const hostListeners = new Set<(message: string) => void>();
  const client: MemoryPort = {
    get sentCount() {
      return clientSentCount;
    },
    send(message) {
      clientSentCount += 1;
      queueMicrotask(() => {
        for (const listener of hostListeners) listener(message);
      });
    },
    addMessageListener(listener) {
      clientListeners.add(listener);
      return () => clientListeners.delete(listener);
    },
  };
  const host: MemoryPort = {
    get sentCount() {
      return hostSentCount;
    },
    send(message) {
      hostSentCount += 1;
      queueMicrotask(() => {
        for (const listener of clientListeners) listener(message);
      });
    },
    addMessageListener(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
  };

  return { connectionId: "memory-link-1", client, host };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}
