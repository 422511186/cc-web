import { describe, expect, it, vi } from "vitest";
import { HttpTransport, TransportError } from "./index.js";

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, (event: { data: string }) => void>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, listener);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitNamed(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }

  emitBroken(): void {
    this.onmessage?.({ data: "not-json" });
  }

  close(): void {
    this.closed = true;
  }
}

describe("HttpTransport", () => {
  it("默认 fetch 以 globalThis 作为 this 调用,兼容浏览器原生 fetch", async () => {
    const originalFetch = globalThis.fetch;
    const seenThisValues: unknown[] = [];
    globalThis.fetch = function (this: unknown) {
      seenThisValues.push(this);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    } as typeof fetch;

    try {
      const transport = new HttpTransport();

      await expect(transport.request({ path: "/projects" })).resolves.toEqual({ ok: true });
      expect(seenThisValues).toEqual([globalThis]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("request 使用 fetch 发送 JSON 请求并附带 Bearer token", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const transport = new HttpTransport({
      baseUrl: "/api",
      getAuthToken: () => "token-123",
      fetchFn,
    });

    const result = await transport.request<{ ok: boolean }, { text: string }>({
      method: "POST",
      path: "/sessions/run-1/message",
      body: { text: "hello" },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith("/api/sessions/run-1/message", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "hello" }),
      keepalive: undefined,
    });
  });

  it("request 收到 401 时触发 onUnauthorized 并抛出服务端错误", async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );
    const transport = new HttpTransport({
      baseUrl: "/api",
      getAuthToken: () => "expired-token",
      onUnauthorized,
      fetchFn,
    });

    await expect(
      transport.request<{ ok: boolean }>({ method: "GET", path: "/projects" })
    ).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    } satisfies Partial<TransportError>);

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("subscribe 使用 EventSource 接收 JSON 事件并支持关闭", () => {
    const sources: FakeEventSource[] = [];
    const events: { type: string; value: number }[] = [];
    const transport = new HttpTransport({
      baseUrl: "/api",
      getAuthToken: () => "token-123",
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    });

    const stream = transport.subscribe<{ type: string; value: number }>({
      path: "/sessions/run-1/stream",
      onEvent: (event) => events.push(event),
    });

    expect(sources[0].url).toBe("/api/sessions/run-1/stream?token=token-123");
    sources[0].emit({ type: "status", value: 1 });
    sources[0].emitBroken();
    stream.close();

    expect(events).toEqual([{ type: "status", value: 1 }]);
    expect(sources[0].closed).toBe(true);
  });

  it("subscribe 支持具名 SSE 事件", () => {
    const sources: FakeEventSource[] = [];
    const events: { sessionId: string }[] = [];
    const transport = new HttpTransport({
      baseUrl: "/api",
      getAuthToken: () => "token-123",
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
    });

    transport.subscribe<{ sessionId: string }>({
      path: "/events",
      eventName: "session-update",
      onEvent: (event) => events.push(event),
    });

    sources[0].emitNamed("session-update", { sessionId: "s1" });

    expect(sources[0].url).toBe("/api/events?token=token-123");
    expect(events).toEqual([{ sessionId: "s1" }]);
  });
});
