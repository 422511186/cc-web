import { randomUUID } from "node:crypto";
import type { ServerEvent } from "@cc-web/shared";
import type { SdkClient } from "./sdk.js";
import { Session } from "./session.js";

export interface SessionManagerOptions {
  client: SdkClient;
  permissionMode: string;
  maxConcurrent: number;
  idleTimeoutMs: number;
  cwd?: string;
}

interface Entry {
  session: Session;
  timer: NodeJS.Timeout;
}

/** 用 runId 构造事件回调的工厂 */
type OnEventFactory = (runId: string) => (e: ServerEvent) => void;

/** 活跃会话池:创建/查找/回收,带并发上限与空闲超时。 */
export class SessionManager {
  private entries = new Map<string, Entry>();
  private opts: SessionManagerOptions;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
  }

  private create(
    runId: string,
    resume: string | undefined,
    onEventFor: OnEventFactory
  ): string {
    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(
        `max concurrent sessions (${this.opts.maxConcurrent}) reached`
      );
    }
    const session = new Session({
      client: this.opts.client,
      permissionMode: this.opts.permissionMode,
      cwd: this.opts.cwd,
      resume,
      onEvent: onEventFor(runId),
    });
    const timer = this.armTimer(runId);
    this.entries.set(runId, { session, timer });
    // 后台跑,结束后自动清理
    void session.runToCompletion().finally(() => this.close(runId, "exited"));
    return runId;
  }

  startNew(onEventFor: OnEventFactory): string {
    return this.create(randomUUID(), undefined, onEventFor);
  }

  startContinue(sessionId: string, onEventFor: OnEventFactory): string {
    return this.create(sessionId, sessionId, onEventFor);
  }

  get(runId: string): Session | undefined {
    return this.entries.get(runId)?.session;
  }

  /** 重置空闲计时器(有活动时调用) */
  touch(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = this.armTimer(runId);
  }

  close(runId: string, reason: "idle" | "aborted" | "exited"): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(runId);
    entry.session.close(reason);
  }

  private armTimer(runId: string): NodeJS.Timeout {
    return setTimeout(
      () => this.close(runId, "idle"),
      this.opts.idleTimeoutMs
    );
  }
}
