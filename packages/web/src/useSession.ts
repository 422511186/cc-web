import { useEffect, useRef, useState, useCallback } from "react";
import type { ServerEvent, PendingPrompt } from "@cc-web/shared";

/** 前端侧的一条流式消息 */
export interface LiveMessage {
  role: "assistant";
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
  const esRef = useRef<EventSource | null>(null);

  const apply = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "delta":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last) {
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
          if (!last) {
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
      case "closed":
        setConnected(false);
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
      es.onopen = () => {
        setConnected(true);
        setError(null);
      };
      es.onmessage = (e) => {
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
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [runId, apply]);

  return { messages, pending, connected, error };
}
