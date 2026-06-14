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
  overrides: Partial<{ maxConcurrent: number; idleTimeoutMs: number }> = {}
) {
  return new SessionManager({
    client: idleClient,
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
