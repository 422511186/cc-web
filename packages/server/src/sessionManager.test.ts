import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "./sessionManager.js";
import type { SdkClient } from "./sdk.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** 一个永不自行结束的 fake SDK(便于测并发/超时) */
const idleClient: SdkClient = {
  start: async function* () {
    await new Promise(() => {}); // 永不 resolve
    yield {} as SDKMessage;
  },
};

function makeManager(
  overrides: Partial<{
    maxConcurrent: number;
    idleTimeoutMs: number;
    client: SdkClient;
  }> = {}
) {
  return new SessionManager({
    client: overrides.client ?? idleClient,
    permissionMode: "default",
    maxConcurrent: overrides.maxConcurrent ?? 5,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 60_000,
  });
}

describe("SessionManager", () => {
  it("creates a new session and returns a runId", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    expect(typeof runId).toBe("string");
    expect(mgr.get(runId)).toBeDefined();
  });

  it("continue uses the given session id as runId", () => {
    const mgr = makeManager();
    const runId = mgr.startContinue("existing-session", () => () => {});
    expect(runId).toBe("existing-session");
  });

  it("throws when exceeding max concurrent sessions", () => {
    const mgr = makeManager({ maxConcurrent: 1 });
    mgr.startNew(() => () => {});
    expect(() => mgr.startNew(() => () => {})).toThrow(/max/i);
  });

  it("close removes the session from the pool", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    mgr.close(runId, "aborted");
    expect(mgr.get(runId)).toBeUndefined();
  });

  it("detach 优雅分离会话:不 abort,从池中移除并调用 session.detach", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    const session = mgr.get(runId)!;
    const detachSpy = vi.spyOn(session, "detach");
    mgr.detach(runId);
    expect(detachSpy).toHaveBeenCalledOnce();
    expect(mgr.get(runId)).toBeUndefined();
  });

  it("detach 未知 runId 安全无操作", () => {
    const mgr = makeManager();
    expect(() => mgr.detach("ghost")).not.toThrow();
  });

  it("release 忙碌会话:保活,留在池中(仅前端断开,后台继续)", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    const session = mgr.get(runId)!;
    session.send("go"); // 进入执行中 → isBusy
    const detachSpy = vi.spyOn(session, "detach");
    mgr.release(runId);
    expect(detachSpy).not.toHaveBeenCalled();
    expect(mgr.get(runId)).toBeDefined(); // 仍在池中,可重连接管
  });

  it("release 空闲会话:立即回收(detach 腾出并发槽)", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    const session = mgr.get(runId)!;
    const detachSpy = vi.spyOn(session, "detach");
    mgr.release(runId); // 没 send,isBusy=false
    expect(detachSpy).toHaveBeenCalledOnce();
    expect(mgr.get(runId)).toBeUndefined();
  });

  it("release 未知 runId 安全无操作", () => {
    const mgr = makeManager();
    expect(() => mgr.release("ghost")).not.toThrow();
  });

  it("事件流续期空闲计时器:执行中持续 emit,不会被空闲超时误杀", () => {
    vi.useFakeTimers();
    const mgr = makeManager({ idleTimeoutMs: 1000 });
    const runId = mgr.startNew(() => () => {});
    // 模拟会话在 800ms、1600ms 各 emit 一次事件(执行中的流式输出)
    vi.advanceTimersByTime(800);
    mgr.onSessionEvent(runId); // 事件到达 → 续期
    vi.advanceTimersByTime(800);
    expect(mgr.get(runId)).toBeDefined(); // 距上次事件仅 800ms,未超时
    mgr.onSessionEvent(runId);
    vi.advanceTimersByTime(800);
    expect(mgr.get(runId)).toBeDefined();
    vi.advanceTimersByTime(300); // 静默累计超过 1000ms
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });

  it("idle timeout closes the session", async () => {
    vi.useFakeTimers();
    const mgr = makeManager({ idleTimeoutMs: 1000 });
    const runId = mgr.startNew(() => () => {});
    expect(mgr.get(runId)).toBeDefined();
    vi.advanceTimersByTime(1001);
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });

  it("touch resets the idle timer", async () => {
    vi.useFakeTimers();
    const mgr = makeManager({ idleTimeoutMs: 1000 });
    const runId = mgr.startNew(() => () => {});
    vi.advanceTimersByTime(800);
    mgr.touch(runId);
    vi.advanceTimersByTime(800); // 距上次 touch 仅 800ms
    expect(mgr.get(runId)).toBeDefined();
    vi.advanceTimersByTime(300); // 累计超过 1000ms
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });
});
