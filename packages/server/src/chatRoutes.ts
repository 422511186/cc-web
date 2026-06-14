import { Router } from "express";
import type {
  ServerEvent,
  PromptAnswer,
  SendMessageRequest,
  StartSessionResponse,
} from "@cc-web/shared";
import type { SessionManager } from "./sessionManager.js";
import { SseChannel } from "./sseChannel.js";

/** 每个 runId 的事件缓冲 + 可选当前 SSE 通道 */
interface Hub {
  buffer: ServerEvent[];
  channel: SseChannel | null;
  /** 会话是否已结束(收到 closed 事件) */
  closed: boolean;
}

export function createChatRouter(mgr: SessionManager): Router {
  const hubs = new Map<string, Hub>();

  function hubFor(runId: string): Hub {
    let hub = hubs.get(runId);
    if (!hub) {
      hub = { buffer: [], channel: null, closed: false };
      hubs.set(runId, hub);
    }
    return hub;
  }

  /** 会话事件回调:有 SSE 连着就直接推,否则缓冲等连接回放 */
  function makeOnEvent(runId: string) {
    return (event: ServerEvent) => {
      const hub = hubFor(runId);
      if (hub.channel) {
        hub.channel.send(event);
      } else {
        hub.buffer.push(event);
      }
      // 会话结束:标记 closed,但保留 hub,让尚未连上的订阅者还能回放缓冲。
      // hub 在订阅者断开(且会话已结束)或缓冲被无人认领回收时清理。
      if (event.type === "closed") {
        hub.closed = true;
        if (!hub.channel && hub.buffer.length === 0) {
          hubs.delete(runId);
        }
      }
    };
  }

  const router = Router();

  // 新建对话
  router.post("/sessions/new", (_req, res) => {
    const runId = mgr.startNew((id) => makeOnEvent(id));
    const body: StartSessionResponse = { runId };
    res.json(body);
  });

  // 续聊
  router.post("/sessions/:id/continue", (req, res) => {
    const sessionId = req.params.id;
    const runId = mgr.startContinue(sessionId, (id) => makeOnEvent(id));
    const body: StartSessionResponse = { runId };
    res.json(body);
  });

  // 发消息
  router.post("/sessions/:runId/message", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const { text } = req.body as SendMessageRequest;
    session.send(text);
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
    const answer = req.body as PromptAnswer;
    const ok = session.answer(answer);
    mgr.touch(runId);
    res.json({ ok });
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
    const channel = new SseChannel(res);
    hub.channel = channel;
    // 回放缓冲
    for (const event of hub.buffer) channel.send(event);
    hub.buffer = [];

    const heartbeat = setInterval(() => channel.heartbeat(), 15_000);
    channel.onClose(() => {
      clearInterval(heartbeat);
      if (hub.channel === channel) hub.channel = null;
      // 会话已结束且无人再连接,回收 hub
      if (hub.closed && !hub.channel) {
        hubs.delete(runId);
      }
    });
  });

  return router;
}
