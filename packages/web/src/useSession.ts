import { useEffect, useRef, useState, useCallback } from "react";
import type { ServerEvent, PendingPrompt } from "@cc-web/shared";

/** 前端侧的一条流式消息 */
export interface LiveMessage {
  role: "assistant" | "user";
  /** 已落定的块 */
  blocks: (
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; name: string; input: unknown; toolUseId: string }
    | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  )[];
  /** 正在流式累积、尚未落定的文本 */
  streaming: string;
}

export interface SessionState {
  messages: LiveMessage[];
  pending: PendingPrompt | null;
  connected: boolean;
  error: string | null;
  /** 执行状态:idle=空闲可发下一条 / executing=执行中 / waiting=等待你回答待答项 */
  status: "idle" | "executing" | "waiting";
  /** 当前活跃 run 的模型(如 'claude-opus-4-8');未知为 null */
  model: string | null;
  /** 推理强度;SDK 输出流不携带,通常为 null(不可用) */
  effort: string | null;
}

function tokenParam(): string {
  const t = sessionStorage.getItem("authToken");
  return t ? `?token=${encodeURIComponent(t)}` : "";
}

/** 订阅一个活跃会话的 SSE 流 */
export function useSession(runId: string | null): SessionState {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "executing" | "waiting">("idle");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const apply = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "user_message":
        setMessages((prev) => [
          ...prev,
          { role: "user", blocks: [{ kind: "text", text: event.text }], streaming: "" },
        ]);
        break;
      case "delta":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last || last.role !== "assistant") {
            last = { role: "assistant", blocks: [], streaming: "" };
            next.push(last);
          } else {
            last = { ...last };
            next[next.length - 1] = last;
          }
          last.streaming += event.text;
          return next;
        });
        break;
      case "block":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last || last.role !== "assistant") {
            last = { role: "assistant", blocks: [], streaming: "" };
            next.push(last);
          } else {
            last = { ...last, blocks: [...last.blocks] };
            next[next.length - 1] = last;
          }
          // 文本块落定时清空 streaming(它就是这块的最终文本)
          if (event.block.kind === "text") last.streaming = "";
          last.blocks.push(event.block);
          return next;
        });
        break;
      case "tool_result":
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            const copy = { ...last, blocks: [...last.blocks] };
            copy.blocks.push({
              kind: "tool_result",
              toolUseId: event.toolUseId,
              text: event.text,
              isError: event.isError,
            });
            next[next.length - 1] = copy;
          }
          return next;
        });
        break;
      case "prompt":
        setPending(event.prompt);
        break;
      case "turn_end":
        setPending(null);
        // 一轮结束:开一条新的空消息容器,下一轮 assistant 输出进新气泡
        setMessages((prev) => [
          ...prev,
          { role: "assistant", blocks: [], streaming: "" },
        ]);
        break;
      case "error":
        setError(event.message);
        break;
      case "status":
        setStatus(event.state);
        break;
      case "run_info":
        if (event.model !== undefined) setModel(event.model);
        if (event.effort !== undefined) setEffort(event.effort);
        break;
      case "closed":
        setConnected(false);
        setStatus("idle");
        break;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled || !runId) return;
      const es = new EventSource(
        `/api/sessions/${encodeURIComponent(runId)}/stream${tokenParam()}`
      );
      esRef.current = es;

      // 立即检查连接状态（某些浏览器 readyState 可能立即变为 OPEN）
      const checkConnection = () => {
        if (es.readyState === EventSource.OPEN) {
          setConnected(true);
        }
      };

      es.onopen = () => {
        // (重)连接成功:重置本地状态,随后吃服务端整段重放从零重建。
        // 这样切走再切回(整段重放)不会与残留状态叠加导致重复。
        setMessages([]);
        setPending(null);
        setError(null);
        setStatus("idle");
        setModel(null);
        setEffort(null);
        setConnected(true);
      };
      es.onmessage = (e) => {
        // 收到首条消息即视为已连接(onopen 可能延后触发)
        setConnected(true);
        try {
          apply(JSON.parse(e.data) as ServerEvent);
        } catch {
          /* 忽略心跳/坏帧 */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        // 自动重连
        retry = setTimeout(connect, 2000);
      };

      // 延迟检查连接状态（给 onopen 一点时间）
      setTimeout(checkConnection, 100);
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [runId, apply]);

  return { messages, pending, connected, error, status, model, effort };
}
