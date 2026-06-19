import { Router } from "express";
import { CLAUDE_SESSION_MODES } from "@coderelay/shared";
import type {
  ServerEvent,
  PromptAnswer,
  SendMessageRequest,
  StartSessionResponse,
  NewSessionRequest,
  ClaudeSessionMode,
} from "@coderelay/shared";
import type { SessionManager } from "./sessionManager.js";
import { SseChannel } from "./sseChannel.js";
import path from "node:path";
import { SessionBus } from "./sessionBus.js";

/** 每个 runId 的 append-only 事件日志 + 多订阅者事件总线 */
interface Hub {
  bus: SessionBus;
  /** 会话是否已结束(收到 closed 事件) */
  closed: boolean;
  /** 会话结束且无连接时的宽限清理计时器,留出重连窗口 */
  graceTimer: NodeJS.Timeout | null;
}

/** 会话结束后保留日志的宽限窗口(ms),供切走再切回的前端重连重放 */
const HUB_GRACE_MS = 60_000;

/** Hub.log 最大事件数,防止长会话内存泄漏 */
const MAX_LOG_EVENTS = 10_000;
const MAX_DEBUG_LOGS = 500;

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function isSafeAbsoluteCwd(value: string): boolean {
  if (!value || value.includes("\0")) return false;
  if (value.includes("..")) return false;
  return path.isAbsolute(value) || isWindowsAbsolutePath(value);
}

/** 把 (projectId, sessionId) 解析成 session 的真实工作目录,供 SDK resume 用 */
export type CwdResolver = (
  projectId: string | undefined,
  sessionId: string
) => Promise<string | null>;

export function createChatRouter(
  mgr: SessionManager,
  resolveCwd?: CwdResolver,
  dirExists?: (cwd: string) => boolean,
  uploadsDir?: string
): Router {
  const hubs = new Map<string, Hub>();
  const debugLogs: Array<Record<string, unknown>> = [];

  function recordDebug(source: "client" | "server", payload: Record<string, unknown>): void {
    const entry = {
      seq: debugLogs.length > 0 ? Number(debugLogs[debugLogs.length - 1].seq) + 1 : 1,
      source,
      at: Date.now(),
      ...payload,
    };
    debugLogs.push(entry);
    if (debugLogs.length > MAX_DEBUG_LOGS) {
      debugLogs.splice(0, debugLogs.length - MAX_DEBUG_LOGS);
    }
    console.info(source === "client" ? "[cc-web:client]" : "[cc-web:agent]", payload);
  }

  function hubFor(runId: string): Hub {
    let hub = hubs.get(runId);
    if (!hub) {
      hub = {
        bus: new SessionBus({ runId, maxLogEvents: MAX_LOG_EVENTS }),
        closed: false,
        graceTimer: null,
      };
      hubs.set(runId, hub);
    }
    return hub;
  }

  /** 丢弃某 runId 的残留 hub(连同宽限计时器)。续聊复用 sessionId 作 runId 时,
   *  上一轮分离遗留的 hub 里含 closed 事件与旧日志,必须清掉,
   *  否则新连接整段重放会重放出旧的 closed,让前端误判会话已结束。 */
  function resetHub(runId: string): void {
    const hub = hubs.get(runId);
    if (!hub) return;
    if (hub.graceTimer) clearTimeout(hub.graceTimer);
    hubs.delete(runId);
  }

  function resolveAttachmentRefs(attachments: unknown): string[] {
    if (!Array.isArray(attachments)) return [];
    return attachments
      .filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0)
      .map((ref) => {
        const filename = path.basename(ref);
        return uploadsDir ? path.join(uploadsDir, filename) : filename;
      });
  }

  /** 会话事件回调:始终追加到全量日志(供重连重放),有 SSE 连着则同时实时推送 */
  function makeOnEvent(runId: string) {
    return (event: ServerEvent) => {
      const hub = hubFor(runId);
      if (event.type === "prompt") {
        hub.bus.trackPrompt(event.prompt.id);
      }
      hub.bus.publish(event);
      // 会话结束:标记 closed,保留 hub 与日志一段宽限期,
      // 让切走再切回的前端还能重连整段重放。
      // 修复 P2-B3:无论是否有连接都预约清理,有连接时由 onClose 取消并重启。
      if (event.type === "closed") {
        hub.closed = true;
        // 始终启动宽限计时器（如果已有则先清除）
        if (hub.graceTimer) {
          clearTimeout(hub.graceTimer);
        }
        hub.graceTimer = setTimeout(() => hubs.delete(runId), HUB_GRACE_MS);
      }
    };
  }

  const router = Router();

  router.post("/debug/client-log", (req, res) => {
    const body = req.body as {
      event?: unknown;
      runId?: unknown;
      sessionId?: unknown;
      projectId?: unknown;
      detail?: unknown;
      ts?: unknown;
    };
    recordDebug("client", {
      event: typeof body.event === "string" ? body.event : "unknown",
      runId: typeof body.runId === "string" ? body.runId : undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      detail: body.detail,
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
    });
    res.json({ ok: true });
  });

  router.get("/debug/logs", (req, res) => {
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_DEBUG_LOGS)
      : 200;
    res.json({ logs: debugLogs.slice(-limit) });
  });

  // 新建对话
  router.post("/sessions/new", (req, res) => {
    try {
      const { cwd } = req.body as NewSessionRequest;

      // 如果提供了 cwd，需要校验
      if (cwd) {
        // 同时接受宿主 OS 绝对路径和 Windows 绝对路径，避免 CI/Linux runner 误判。
        if (!isSafeAbsoluteCwd(cwd)) {
          res.status(400).json({ error: "非法路径" });
          return;
        }

        // 检查目录是否存在
        if (dirExists && !dirExists(cwd)) {
          res.status(400).json({ error: "目录不存在" });
          return;
        }
      }

      const runId = mgr.startNew((id) => makeOnEvent(id), cwd);
      recordDebug("server", {
        event: "server.start-new",
        runId,
        cwd,
        activeCount: mgr.listActiveAgents().length,
      });
      const body: StartSessionResponse = { runId };
      res.json(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/max concurrent/i.test(message)) {
        res.status(409).json({ error: message });
        return;
      }
      throw error;
    }
  });

  // 续聊
  router.post("/sessions/:id/continue", async (req, res) => {
    try {
      const sessionId = req.params.id;
      const projectId = (req.body as { projectId?: string })?.projectId;
      const cwd = resolveCwd
        ? (await resolveCwd(projectId, sessionId)) ?? undefined
        : undefined;
      // 原项目目录已不存在则无法 resume,给出友好错误而非启动后抛 SDK 错误
      if (cwd && dirExists && !dirExists(cwd)) {
        res.status(409).json({ error: "原项目目录已不存在,无法续聊" });
        return;
      }
      // 复用 sessionId 作 runId:清掉上一轮分离遗留的 hub(含旧 closed 事件),
      // 避免新连接整段重放时重放出旧 closed 导致前端误判已结束/卡连接中。
      resetHub(sessionId);
      const runId = mgr.startContinue(sessionId, (id) => makeOnEvent(id), cwd, projectId);
      recordDebug("server", {
        event: "server.start-continue",
        runId,
        sessionId,
        projectId,
        cwd,
        activeCount: mgr.listActiveAgents().length,
      });
      const body: StartSessionResponse = { runId };
      res.json(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/max concurrent/i.test(message)) {
        res.status(409).json({ error: message });
        return;
      }
      throw error;
    }
  });

  router.get("/sessions/active", (_req, res) => {
    const agents = mgr.listActiveAgents();
    recordDebug("server", {
      event: "server.active-list",
      count: agents.length,
      agents: agents.map((agent) => ({
        runId: agent.runId,
        sessionId: agent.sessionId,
        projectId: agent.projectId,
        status: agent.status,
        attached: agent.attached,
      })),
    });
    res.json({
      agents,
      maxConcurrent: mgr.getMaxConcurrent(),
    });
  });

  // 发消息
  router.get("/sessions/:runId", (req, res) => {
    const runId = req.params.runId;
    if (!mgr.get(runId)) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.json({ runId, active: true });
  });

  router.post("/sessions/:runId/heartbeat", (req, res) => {
    const heartbeat = mgr.heartbeat(req.params.runId);
    if (!heartbeat) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    recordDebug("server", {
      event: "server.heartbeat",
      runId: req.params.runId,
      status: heartbeat.status,
      leaseExpiresAt: heartbeat.leaseExpiresAt,
    });
    res.json({ ok: true, ...heartbeat });
  });

  router.patch("/sessions/:runId/mode", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }

    const body = req.body as { mode?: unknown; deviceName?: unknown };
    if (typeof body.mode !== "string" || !CLAUDE_SESSION_MODES.includes(body.mode as ClaudeSessionMode)) {
      res.status(400).json({ error: "invalid mode" });
      return;
    }
    const deviceName = typeof body.deviceName === "string" && body.deviceName.trim()
      ? body.deviceName.trim()
      : "此设备";
    const appliesTo = session.setMode(body.mode as ClaudeSessionMode, deviceName);
    mgr.touch(runId);
    res.json({ ok: true, mode: body.mode, appliesTo });
  });

  // 发消息
  router.post("/sessions/:runId/message", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const { text, attachments } = req.body as SendMessageRequest;
    session.send(text, resolveAttachmentRefs(attachments));
    mgr.touch(runId);
    res.json({ ok: true });
  });

  // 提交答案(权限/答题/计划)
  router.post("/sessions/:runId/respond", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const answer = req.body as PromptAnswer & { deviceName?: string };
    const deviceName = typeof answer.deviceName === "string" && answer.deviceName.trim()
      ? answer.deviceName.trim()
      : "此设备";
    const promptResolution = hubFor(runId).bus.resolvePrompt(answer.id, deviceName, decisionFromAnswer(answer));
    if (promptResolution.reason === "prompt_already_resolved") {
      res.json(promptResolution);
      return;
    }
    const ok = session.answer(answer);
    mgr.touch(runId);
    recordDebug("server", {
      event: "server.respond",
      runId,
      answerId: answer.id,
      kind: answer.kind,
      ok,
    });
    res.json({ ok });
  });

  // 强制终止会话执行(用户点击停止按钮)
  router.post("/sessions/:runId/abort", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    mgr.abort(runId);
    res.json({ ok: true });
  });

  router.post("/sessions/:runId/close", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    mgr.close(runId, "aborted");
    res.json({ ok: true });
  });

  // 释放会话(切换会话/关闭页面时调用)。忙碌则保活(留池中待重连),空闲则回收。
  // 不中断后台执行,让当前轮次跑完。幂等:未知 runId 也返回 ok。
  router.delete("/sessions/:runId", (req, res) => {
    mgr.release(req.params.runId);
    res.json({ ok: true });
  });

  // SSE 订阅
  router.get("/sessions/:runId/stream", (req, res) => {
    const runId = req.params.runId;
    // 会话仍活跃,或已结束但还有缓冲事件待回放,都允许订阅。
    if (!mgr.get(runId) && !hubs.has(runId)) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const hub = hubFor(runId);
    // 取消宽限清理:有人连上了,日志要留着供这次重放
    if (hub.graceTimer) {
      clearTimeout(hub.graceTimer);
      hub.graceTimer = null;
    }
    const channel = new SseChannel(res);
    hub.channel = channel;
    recordDebug("server", {
      event: "server.stream-open",
      runId,
      replayCount: hub.bus.eventCount(),
      active: Boolean(mgr.get(runId)),
      closed: hub.closed,
    });
    // 整段重放全量日志(支持切走再切回的重连),日志不清空
    const subscriberId = `${runId}:${Date.now()}:${Math.random()}`;
    const unsubscribe = hub.bus.subscribe(subscriberId, (event) => channel.send(event));

    const heartbeat = setInterval(() => channel.heartbeat(), 15_000);
    channel.onClose(() => {
      clearInterval(heartbeat);
      unsubscribe();
      recordDebug("server", {
        event: "server.stream-close",
        runId,
        replayCount: hub.bus.eventCount(),
        active: Boolean(mgr.get(runId)),
        closed: hub.closed,
      });
      // 会话已结束且无人再连接:启动宽限清理,留出重连窗口后回收 hub
      if (hub.closed && hub.bus.subscriberCount() === 0 && !hub.graceTimer) {
        hub.graceTimer = setTimeout(() => hubs.delete(runId), HUB_GRACE_MS);
      }
    });
  });

  return router;
}

function decisionFromAnswer(answer: PromptAnswer): string {
  if (answer.kind === "permission" || answer.kind === "plan") {
    return answer.decision;
  }
  return "answered";
}
