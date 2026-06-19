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

  it("round-trips FormData file uploads through the P2P bridge", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const link = createMemoryLink();
    let forwardedBody: unknown;
    createP2PBridge(link.host, {
      handleRequest: async (request: { body: unknown }) => {
        forwardedBody = request.body;
        return { status: 200, body: { ok: true } };
      },
    });
    const client = new P2PTransport({ port: link.client });
    const form = new FormData();
    form.append("description", "upload from phone");
    form.append("file", new File(["hello over p2p"], "note.txt", { type: "text/plain" }));

    await expect(client.request({ method: "POST", path: "/uploads", body: form })).resolves.toEqual({ ok: true });

    expect(forwardedBody).toBeInstanceOf(FormData);
    const forwardedForm = forwardedBody as FormData;
    expect(forwardedForm.get("description")).toBe("upload from phone");
    const file = forwardedForm.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("note.txt");
    expect((file as File).type).toBe("text/plain");
    await expect((file as File).text()).resolves.toBe("hello over p2p");
  });

  it("chunks oversized response frames so long sessions do not exceed DataChannel message limits", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const createP2PBridge = expectApiFunction("createP2PBridge");
    const link = createMemoryLink({ maxMessageSize: 262_144 });
    const longContent = "x".repeat(300_000);
    createP2PBridge(link.host, {
      handleRequest: async () => ({
        status: 200,
        body: {
          session: {
            id: "long-session",
            messages: [{ role: "assistant", content: longContent }],
          },
        },
      }),
    });
    const client = new P2PTransport({ port: link.client });

    await expect(client.request<{ session: { messages: Array<{ content: string }> } }>({
      method: "GET",
      path: "/sessions/long-session",
    })).resolves.toEqual({
      session: {
        id: "long-session",
        messages: [{ role: "assistant", content: longContent }],
      },
    });
    expect(link.maxSentLength).toBeLessThanOrEqual(262_144);
    expect(link.host.sentCount).toBeGreaterThan(1);
  });

  it("rejects the request promise when FormData serialization fails", async () => {
    const P2PTransport = expectApiFunction("P2PTransport");
    const link = createMemoryLink();
    const client = new P2PTransport({ port: link.client });
    const form = new FormData();
    form.append("file", new File(["hello"], "note.txt"));
    const readError = new Error("cannot read file");
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer").mockRejectedValue(readError);

    try {
      await expect(client.request({ method: "POST", path: "/uploads", body: form })).rejects.toThrow(
        "cannot read file",
      );
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });
});

interface MemoryPort {
  readonly sentCount: number;
  send(message: string): void;
  addMessageListener(listener: (message: string) => void): () => void;
}

function createMemoryLink(options: { readonly maxMessageSize?: number } = {}): {
  readonly connectionId: string;
  readonly client: MemoryPort;
  readonly host: MemoryPort;
  readonly maxSentLength: number;
} {
  let clientSentCount = 0;
  let hostSentCount = 0;
  let maxSentLength = 0;
  const clientListeners = new Set<(message: string) => void>();
  const hostListeners = new Set<(message: string) => void>();
  const recordMessage = (message: string) => {
    maxSentLength = Math.max(maxSentLength, message.length);
    if (options.maxMessageSize && message.length > options.maxMessageSize) {
      throw new Error(`max-message-size exceeded: ${message.length} > ${options.maxMessageSize}`);
    }
  };
  const client: MemoryPort = {
    get sentCount() {
      return clientSentCount;
    },
    send(message) {
      recordMessage(message);
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
      recordMessage(message);
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

  return {
    connectionId: "memory-link-1",
    client,
    host,
    get maxSentLength() {
      return maxSentLength;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}
