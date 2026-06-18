import { describe, it, expect, vi } from "vitest";
import { SseChannel } from "./sseChannel.js";
import type { ServerEvent } from "@cc-web/shared";

/** 最小 fake Express Response */
function fakeRes() {
  const chunks: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    headersSent: false,
    writeHead: vi.fn(),
    write: vi.fn((s: string) => {
      chunks.push(s);
      return true;
    }),
    end: vi.fn(),
    on: vi.fn((ev: string, cb: () => void) => {
      handlers[ev] = cb;
    }),
    flushHeaders: vi.fn(),
    chunks,
    handlers,
  };
}

describe("SseChannel", () => {
  it("construction immediately writes a comment frame so EventSource opens without waiting for heartbeat", () => {
    const res = fakeRes();
    new SseChannel(res as never);
    expect(res.chunks.join("")).toBe(`: connected\n\n`);
  });

  it("writes an event as 'data: <json>\\n\\n'", () => {
    const res = fakeRes();
    const ch = new SseChannel(res as never);
    const event: ServerEvent = { type: "delta", text: "hi" };
    ch.send(event);
    expect(res.chunks.join("")).toBe(
      `: connected\n\ndata: ${JSON.stringify(event)}\n\n`
    );
  });

  it("sets SSE headers on construction", () => {
    const res = fakeRes();
    new SseChannel(res as never);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" })
    );
  });

  it("heartbeat writes a comment line", () => {
    const res = fakeRes();
    const ch = new SseChannel(res as never);
    ch.heartbeat();
    expect(res.chunks.join("")).toBe(`: connected\n\n: ping\n\n`);
  });

  it("invokes onClose when the client disconnects", () => {
    const res = fakeRes();
    const onClose = vi.fn();
    const ch = new SseChannel(res as never);
    ch.onClose(onClose);
    res.handlers["close"]?.();
    expect(onClose).toHaveBeenCalled();
  });
});
