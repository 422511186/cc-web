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
    onEventFor: OnEventFactory,
    cwd?: string
  ): string {
    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(
        `max concurrent sessions (${this.opts.maxConcurrent}) reached`
      );
    }
    const session = new Session({
      client: this.opts.client,
      permissionMode: this.opts.permissionMode,
      cwd: cwd ?? this.opts.cwd,
      resume,
      // 包一层:会话每 emit 一个事件就续期空闲计时器,
      // 执行中的流式输出会让会话保持存活,不被空闲超时误杀。
      onEvent: this.wrapOnEvent(runId, onEventFor(runId)),
    });
    const timer = this.armTimer(runId);
    this.entries.set(runId, { session, timer });
    // 后台跑,结束后自动清理
    void session.runToCompletion().finally(() => this.close(runId, "exited"));
    return runId;
  }

  startNew(onEventFor: OnEventFactory, cwd?: string): string {
    return this.create(randomUUID(), undefined, onEventFor, cwd);
  }

  startContinue(sessionId: string, onEventFor: OnEventFactory, cwd?: string): string {
    return this.create(sessionId, sessionId, onEventFor, cwd);
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

  /**
   * 优雅分离:前端断开/切换/关页面时调用。从池中移除、停掉空闲计时器,
   * 但不 abort —— 正在执行的轮次继续在后台跑完后自然退出。
   */
  detach(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(runId);
    entry.session.detach();
  }

  /**
   * 释放(前端切走/关页面):忙碌(执行中或等待答题)则**保活**——留在池中,
   * 后台继续跑、靠事件流续期,稍后可重连接管;空闲则立即 detach 回收并发槽。
   */
  release(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    if (entry.session.isBusy()) return; // 忙碌:保活,等重连或空闲超时
    this.detach(runId);
  }

  /** 强制终止会话执行(用户点击停止按钮) */
  abort(runId: string): void {
    this.close(runId, "aborted");
  }

  /** 会话有事件产出时调用:续期空闲计时器(执行中的流不会被误杀) */
  onSessionEvent(runId: string): void {
    this.touch(runId);
  }

  /** 把会话事件回调包一层:每次 emit 先续期空闲计时器,再转交真正回调 */
  private wrapOnEvent(
    runId: string,
    onEvent: (e: ServerEvent) => void
  ): (e: ServerEvent) => void {
    return (event: ServerEvent) => {
      this.touch(runId);
      onEvent(event);
    };
  }

  private armTimer(runId: string): NodeJS.Timeout {
    return setTimeout(
      () => this.close(runId, "idle"),
      this.opts.idleTimeoutMs
    );
  }
}
