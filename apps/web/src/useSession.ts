import { useEffect, useRef, useState, useCallback } from "react";
import type { ClaudeSessionMode, ServerEvent, PendingPrompt } from "@coderelay/shared";
import { HttpTransport, type CodeRelayTransport, type TransportStream } from "@coderelay/transport";
import { clientLog } from "./diagnostics";
import { getHttpApiBase } from "./apiBase";

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
  imagePaths?: string[];
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
  /** 会话是否已收到 closed 事件而终结(分离/中止/退出/空闲) */
  closed: boolean;
  /** closed 的原因;未结束为 null */
  closedReason: string | null;
  mode: ClaudeSessionMode;
  lastPromptResolution: {
    promptId: string;
    resolvedByDeviceName: string;
    decision: string;
  } | null;
}

let sessionTransport: CodeRelayTransport | null = null;

export function setSessionTransport(transport: CodeRelayTransport | null): void {
  sessionTransport = transport;
}

function activeSessionTransport(): CodeRelayTransport {
  return (
    sessionTransport ??
    new HttpTransport({
      baseUrl: getHttpApiBase(),
      getAuthToken: () => sessionStorage.getItem("authToken"),
    })
  );
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
  const [closed, setClosed] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [mode, setMode] = useState<ClaudeSessionMode>("auto");
  const [lastPromptResolution, setLastPromptResolution] = useState<SessionState["lastPromptResolution"]>(null);
  const streamRef = useRef<TransportStream | null>(null);
  const rebuildingRef = useRef(false);

  const apply = useCallback((event: ServerEvent) => {
    if (rebuildingRef.current) {
      rebuildingRef.current = false;
      setMessages([]);
      setPending(null);
      setError(null);
      setStatus("idle");
      setModel(null);
      setEffort(null);
      setClosed(false);
      setClosedReason(null);
      setMode("auto");
      setLastPromptResolution(null);
    }

    switch (event.type) {
      case "user_message":
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            blocks: [{ kind: "text", text: event.text }],
            ...(event.imagePaths && event.imagePaths.length > 0
              ? { imagePaths: event.imagePaths }
              : {}),
            streaming: "",
          },
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
      case "prompt_resolved":
        setPending((current) => current?.id === event.promptId ? null : current);
        setLastPromptResolution({
          promptId: event.promptId,
          resolvedByDeviceName: event.resolvedByDeviceName,
          decision: event.decision,
        });
        break;
      case "turn_end":
        setPending(null);
        break;
      case "error":
        setError(event.message);
        setPending(null);
        setStatus("idle");
        break;
      case "status":
        if (event.state !== "waiting") {
          setPending(null);
        }
        setStatus(event.state);
        break;
      case "run_info":
        if (event.model !== undefined) setModel(event.model);
        if (event.effort !== undefined) setEffort(event.effort);
        break;
      case "mode_changed":
        setMode(event.mode);
        break;
      case "closed":
        setConnected(false);
        setStatus("idle");
        setClosed(true);
        setClosedReason(event.reason ?? null);
        break;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    // runId 变化代表切到另一个后端 run,必须立即清空上一 run 的实时态。
    // 同一 run 的 SSE 重连不会触发此 effect,仍由 onopen 后首条重放事件做无闪烁重建。
    setMessages([]);
    setPending(null);
    setError(null);
    setStatus("idle");
    setModel(null);
    setEffort(null);
    setClosed(false);
    setClosedReason(null);
    setMode("auto");
    setLastPromptResolution(null);
    setConnected(false);
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0; // 重连次数
    const MAX_RETRIES = 5; // 最多重连5次

    function connect() {
      if (cancelled || !runId) return;
      clientLog("sse.connect", { runId });
      const stream = activeSessionTransport().subscribe<ServerEvent>({
        path: `/sessions/${encodeURIComponent(runId)}/stream`,
        onOpen: () => {
        clientLog("sse.open", { runId });
        // (重)连接成功后等待首条重放事件时再原子重建。
        // 这样在 onopen 到首条重放之间不会瞬间清空 UI 造成闪烁。
        rebuildingRef.current = true;
        setError(null);
        setClosed(false);
        setClosedReason(null);
        setConnected(true);
        // 连接成功，重置重试计数
        retryCount = 0;
        },
        onEvent: (event) => {
        // 收到首条消息即视为已连接(onopen 可能延后触发)
        setConnected(true);
        clientLog("sse.message", { runId, type: event.type });
        apply(event);
        },
        onError: () => {
        clientLog("sse.error", { runId, retryCount });
        setConnected(false);
        streamRef.current?.close();

        // 检查是否超过重试次数
        if (retryCount >= MAX_RETRIES) {
          setError('重连失败：已达最大重试次数');
          return;
        }

        // 指数退避：1s, 2s, 4s, 8s, 16s
        const delay = Math.pow(2, retryCount) * 1000;
        retryCount++;

        retry = setTimeout(connect, delay);
        },
      });
      streamRef.current = stream;
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clientLog("sse.cleanup", { runId });
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [runId, apply]);

  return {
    messages,
    pending,
    connected,
    error,
    status,
    model,
    effort,
    closed,
    closedReason,
    mode,
    lastPromptResolution,
  };
}
