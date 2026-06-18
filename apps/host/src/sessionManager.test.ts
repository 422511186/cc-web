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
    heartbeatTtlMs: number;
    orphanIdleTimeoutMs: number;
    client: SdkClient;
  }> = {}
) {
  return new SessionManager({
    client: overrides.client ?? idleClient,
    permissionMode: "default",
    maxConcurrent: overrides.maxConcurrent ?? 5,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 60_000,
    heartbeatTtlMs: overrides.heartbeatTtlMs,
    orphanIdleTimeoutMs: overrides.orphanIdleTimeoutMs,
  });
}

describe("SessionManager", () => {
  it("lists active agents with metadata and status", () => {
    const mgr = makeManager();

    const newRunId = mgr.startNew(() => () => {}, "C:/workspace/a");
    const continueRunId = mgr.startContinue("sess-1", () => () => {}, "C:/workspace/b", "proj-1");

    const continued = mgr.get(continueRunId)!;
    continued.send("继续跑");

    const agents = mgr.listActiveAgents();
    const newAgent = agents.find((agent) => agent.runId === newRunId);
    const continueAgent = agents.find((agent) => agent.runId === continueRunId);

    expect(newAgent).toMatchObject({
      runId: newRunId,
      kind: "new",
      sessionId: null,
      cwd: "C:/workspace/a",
      status: "idle",
    });
    expect(continueAgent).toMatchObject({
      runId: continueRunId,
      kind: "continue",
      sessionId: "sess-1",
      projectId: "proj-1",
      cwd: "C:/workspace/b",
      status: "executing",
    });
    expect(typeof continueAgent?.createdAt).toBe("number");
    expect(typeof continueAgent?.lastEventAt).toBe("number");
  });

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

  it("abort 只停止当前轮次,不从池中移除会话", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => () => {});
    const session = mgr.get(runId)!;
    const abortSpy = vi.spyOn(session, "abortCurrentTurn");

    mgr.abort(runId);

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(mgr.get(runId)).toBe(session);
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

  it("heartbeat 租约存在时 idle run 不应按普通 idleTimeout 回收,租约过期后再回收", () => {
    vi.useFakeTimers();
    const mgr = makeManager({
      idleTimeoutMs: 1000,
      heartbeatTtlMs: 5000,
      orphanIdleTimeoutMs: 2000,
    });
    const runId = mgr.startNew(() => () => {});

    const heartbeat = mgr.heartbeat(runId);

    expect(heartbeat?.attached).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(mgr.get(runId)).toBeDefined();

    vi.advanceTimersByTime(5998);
    expect(mgr.get(runId)).toBeDefined();

    vi.advanceTimersByTime(2);
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });

  it("复用 runId 续聊:旧会话流结束的兜底 close 不得误杀已重建的新会话", async () => {
    // 可控结束的 fake SDK:第一条流等外部信号才结束,后续流永不结束。
    let endFirst!: () => void;
    const firstEnded = new Promise<void>((r) => (endFirst = r));
    let call = 0;
    const controllableClient: SdkClient = {
      start: async function* () {
        const mine = call++;
        if (mine === 0) {
          await firstEnded; // 第一条流:等信号
        } else {
          await new Promise(() => {}); // 后续流:永不结束
        }
        yield {} as SDKMessage;
      },
    };
    const mgr = makeManager({ client: controllableClient });

    // 1) 续聊 sA(第一次)
    const runId = mgr.startContinue("sA", () => () => {});
    const first = mgr.get(runId)!;

    // 2) 切走:优雅分离(从池移除)
    mgr.detach(runId);
    expect(mgr.get(runId)).toBeUndefined();

    // 3) 再次续聊 sA:同一 runId 重建一个新会话
    mgr.startContinue("sA", () => () => {});
    const second = mgr.get(runId)!;
    expect(second).not.toBe(first); // 确实是新实例

    // 4) 旧会话的 SDK 流此刻才自然结束 → 触发其 runToCompletion().finally
    endFirst();
    await new Promise((r) => setTimeout(r, 0)); // 放行微任务,让 finally 执行

    // 5) 新会话不得被旧流的兜底 close 误杀
    expect(mgr.get(runId)).toBe(second);
  });

  it("并发检查非原子:两个 startNew 同时检查 size 可能都通过并超出上限", async () => {
    const mgr = makeManager({ maxConcurrent: 2 });

    // 先占满 1 个槽位
    mgr.startNew(() => () => {});

    // 模拟并发场景:两个请求几乎同时到达
    // 修复前:两个都会先检查 size(1) < maxConcurrent(2),都通过,最终池中有 3 个会话
    // 修复后:插入后检查,第二个会回滚并抛错,最终池中只有 2 个会话
    const promises = [
      Promise.resolve().then(() => mgr.startNew(() => () => {})),
      Promise.resolve().then(() => mgr.startNew(() => () => {})),
    ];

    const results = await Promise.allSettled(promises);

    // 预期:有一个成功,一个失败(超限),最终池中只有 2 个会话
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toMatch(/max concurrent/);
    expect(mgr["entries"].size).toBe(2);
  });
});
