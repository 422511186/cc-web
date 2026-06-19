import { describe, expect, it, vi } from "vitest";
import { SessionBus } from "./sessionBus.js";

describe("SessionBus", () => {
  it("向多个订阅者广播事件，并在新订阅者连接时回放日志", () => {
    const bus = new SessionBus({ runId: "run-1" });
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe("sub-1", first);
    bus.publish({ type: "status", state: "executing" });
    bus.subscribe("sub-2", second);
    bus.publish({ type: "status", state: "idle" });

    expect(first.mock.calls.map(([event]) => event)).toEqual([
      { type: "status", state: "executing" },
      { type: "status", state: "idle" },
    ]);
    expect(second.mock.calls.map(([event]) => event)).toEqual([
      { type: "status", state: "executing" },
      { type: "status", state: "idle" },
    ]);
    expect(bus.subscriberCount()).toBe(2);
  });

  it("取消订阅后不再接收新事件", () => {
    const bus = new SessionBus({ runId: "run-1" });
    const subscriber = vi.fn();

    const unsubscribe = bus.subscribe("sub-1", subscriber);
    unsubscribe();
    bus.publish({ type: "status", state: "idle" });

    expect(subscriber).not.toHaveBeenCalled();
    expect(bus.subscriberCount()).toBe(0);
  });

  it("使用 operationId 对客户端重试做幂等", () => {
    const bus = new SessionBus({ runId: "run-1" });

    const first = bus.claimOperation("op-1", { ok: true });
    const second = bus.claimOperation("op-1", { ok: false });

    expect(first).toEqual({ first: true, result: { ok: true } });
    expect(second).toEqual({ first: false, result: { ok: true } });
  });

  it("同一 prompt 只能由第一个客户端处理", () => {
    const bus = new SessionBus({ runId: "run-1" });
    const subscriber = vi.fn();
    bus.subscribe("sub-1", subscriber);

    bus.trackPrompt("perm-1");

    expect(bus.resolvePrompt("perm-1", "Chrome on Android", "allow")).toEqual({
      ok: true,
      resolvedByDeviceName: "Chrome on Android",
    });
    expect(bus.resolvePrompt("perm-1", "Edge on Windows", "deny")).toEqual({
      ok: false,
      reason: "prompt_already_resolved",
      resolvedByDeviceName: "Chrome on Android",
    });
    expect(subscriber).toHaveBeenCalledWith({
      type: "prompt_resolved",
      promptId: "perm-1",
      resolvedByDeviceName: "Chrome on Android",
      decision: "allow",
    });
  });

  it("未知 prompt 返回 prompt_not_found", () => {
    const bus = new SessionBus({ runId: "run-1" });

    expect(bus.resolvePrompt("missing", "Chrome on Android", "allow")).toEqual({
      ok: false,
      reason: "prompt_not_found",
    });
  });
});
