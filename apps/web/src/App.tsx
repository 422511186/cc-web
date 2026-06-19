import { useState, useEffect, useCallback, useRef } from 'react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { MobileMenu } from './components/MobileMenu';
import { Composer } from './components/Composer';
import { AlertDialog } from './components/AlertDialog';
import { useSession, setSessionTransport } from './useSession';
import { startNew, startContinue, sendMessage, respond, closeSession, abortSession, probeRun, listActiveAgents, closeAgent, heartbeatSession, setChatTransport } from './chatApi';
import { createApiClient } from './api';
import type { ApiClient, P2PPairingResponse } from './api';
import type { ActiveAgent, PromptAnswer, PendingPrompt, Project } from '@coderelay/shared';
import type { LiveMessage } from './useSession';
import { clientLog, setDiagnosticsTransport } from './diagnostics';
import { QuestionCard } from './components/QuestionCard';
import { PermissionCard } from './components/PermissionCard';
import { PlanCard } from './components/PlanCard';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import QRCode from 'qrcode';
import {
  connectBrowserP2P,
  connectTrustedBrowserP2P,
  currentPairingOffer,
  loadLastTrustedHostProfile,
  type BrowserP2PSession,
} from './p2pClient';
import type { CodeRelayTransport } from '@coderelay/transport';

function isUnauthorizedError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    return (error as { status?: unknown }).status === 401;
  }
  return error instanceof Error && /\b401\b/.test(error.message);
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    return (error as { status?: unknown }).status === 404;
  }
  return error instanceof Error && /\b404\b/.test(error.message);
}

function areActiveAgentsEqual(left: ActiveAgent[], right: ActiveAgent[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((agent, index) => {
    const other = right[index];
    return (
      agent.runId === other.runId &&
      agent.kind === other.kind &&
      agent.sessionId === other.sessionId &&
      agent.projectId === other.projectId &&
      agent.status === other.status &&
      agent.createdAt === other.createdAt &&
      agent.lastEventAt === other.lastEventAt
    );
  });
}

/** 纯新建会话视图:无历史 session,只展示实时流式消息与待答卡片 */
function NewSessionView({ liveMessages, pending, onAnswer }: {
  liveMessages: LiveMessage[];
  pending: PendingPrompt | null;
  onAnswer: (a: PromptAnswer) => void;
}) {
  return (
    <div
      data-testid="new-session-view"
      style={{ height: '100%', overflow: 'auto', padding: '1.5rem', backgroundColor: '#fff' }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {liveMessages.map((m, i) => {
          if (m.blocks.length === 0 && !m.streaming) return null;
          // 用户消息(乐观插入):右对齐气泡
          if (m.role === 'user') {
            const text = m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('');
            return (
              <div key={`new-${i}`} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <div style={{
                  maxWidth: '65%', padding: '0.875rem 1.125rem', borderRadius: '12px',
                  backgroundColor: 'rgb(242, 242, 242)', color: '#2c2c2c', whiteSpace: 'pre-wrap',
                }}>
                  {text}
                </div>
              </div>
            );
          }
          return (
            <div key={`new-${i}`} style={{ marginBottom: '1rem' }}>
              {m.blocks.map((b, bi) => {
                if (b.kind === 'text') {
                  const html = marked.parse(b.text, { async: false }) as string;
                  const sanitizedHtml = DOMPurify.sanitize(html);
                  return (
                    <div
                      key={bi}
                      className="markdown-content"
                      style={{ lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                  );
                }
                if (b.kind === 'thinking') {
                  return <div key={bi} style={{ color: '#888', fontStyle: 'italic' }}>💭 {b.text.slice(0, 80)}</div>;
                }
                if (b.kind === 'tool_use') {
                  return <div key={bi} style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.85rem' }}>🔧 {b.name}</div>;
                }
                return <div key={bi} style={{ color: '#555', fontSize: '0.85rem' }}>{b.isError ? '工具结果 ✗' : '工具结果 ✓'}</div>;
              })}
              {m.streaming && <div className="msg-streaming" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{m.streaming}</div>}
            </div>
          );
        })}
        {pending && (
          <div className="pending-card">
            {pending.kind === 'question' && <QuestionCard prompt={pending} onAnswer={onAnswer} />}
            {pending.kind === 'permission' && <PermissionCard prompt={pending} onAnswer={onAnswer} />}
            {pending.kind === 'plan' && <PlanCard prompt={pending} onAnswer={onAnswer} />}
          </div>
        )}
      </div>
    </div>
  );
}

function NewSessionDialog({
  open,
  projects,
  onCreate,
  onClose,
}: {
  open: boolean;
  projects: Project[];
  onCreate: (cwd: string) => Promise<void>;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setCwd('');
  }, [open]);

  if (!open) return null;

  async function createWith(path: string) {
    const normalized = path.trim();
    if (!normalized) return;
    setBusy(true);
    try {
      await onCreate(normalized);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-label="新建会话"
        onSubmit={(e) => {
          e.preventDefault();
          void createWith(cwd);
        }}
        style={{
          width: 'min(560px, 100%)',
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #d8dee4',
          boxShadow: '0 16px 48px rgba(31,35,40,0.18)',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#24292f' }}>新建会话</div>
            <div style={{ color: '#6e7781', fontSize: '0.82rem', marginTop: '0.2rem' }}>
              选择已有项目，或输入一个工作目录路径。
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭新建会话"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              border: '1px solid #d8dee4',
              borderRadius: 6,
              background: '#fff',
              color: '#57606a',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {projects.length > 0 && (
          <div style={{ marginBottom: '0.9rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#6e7781', marginBottom: '0.4rem', fontWeight: 600 }}>
              已有项目
            </div>
            <div style={{ display: 'grid', gap: '0.45rem', maxHeight: 180, overflow: 'auto' }}>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void createWith(project.path)}
                  style={{
                    textAlign: 'left',
                    padding: '0.62rem 0.7rem',
                    border: '1px solid #d8dee4',
                    borderRadius: 6,
                    background: '#f6f8fa',
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 650, color: '#24292f', marginBottom: '0.18rem' }}>
                    {project.name}
                  </div>
                  <div style={{
                    color: '#6e7781',
                    fontSize: '0.76rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {project.path}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <label htmlFor="new-session-cwd" style={{ display: 'block', fontSize: '0.78rem', color: '#6e7781', marginBottom: '0.4rem', fontWeight: 600 }}>
          工作目录路径
        </label>
        <input
          id="new-session-cwd"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="例如 C:/Users/huang/workspace/my-project"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.62rem 0.7rem',
            border: '1px solid #d8dee4',
            borderRadius: 6,
            fontSize: '0.9rem',
            marginBottom: '0.85rem',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 0.9rem',
              border: '1px solid #d8dee4',
              borderRadius: 6,
              background: '#fff',
              color: '#24292f',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !cwd.trim()}
            style={{
              padding: '0.5rem 0.95rem',
              border: '1px solid #0969da',
              borderRadius: 6,
              background: busy || !cwd.trim() ? '#eaeef2' : '#0969da',
              color: busy || !cwd.trim() ? '#6a737d' : '#fff',
              cursor: busy || !cwd.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            创建会话
          </button>
        </div>
      </form>
    </div>
  );
}

function PairingDialog({
  pairing,
  onClose,
}: {
  pairing: P2PPairingResponse | null;
  onClose: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    setQrDataUrl(null);
    void QRCode.toDataURL(pairing.pairingUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrDataUrl(dataUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pairing]);

  if (!pairing) return null;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2100,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="添加设备"
        style={{
          width: 'min(480px, 100%)',
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #d8dee4',
          boxShadow: '0 16px 48px rgba(31,35,40,0.18)',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#24292f' }}>添加设备</div>
            <div style={{ color: '#6e7781', fontSize: '0.82rem', marginTop: '0.2rem' }}>
              用手机打开下方链接或扫码完成 P2P 配对。
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭添加设备"
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              border: '1px solid #d8dee4',
              borderRadius: 6,
              background: '#fff',
              color: '#57606a',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', minHeight: 220 }}>
          {qrDataUrl ? (
            <img
              alt="配对二维码"
              src={qrDataUrl}
              style={{ width: 220, height: 220, imageRendering: 'pixelated' }}
            />
          ) : (
            <div style={{ color: '#6e7781', alignSelf: 'center' }}>正在生成二维码…</div>
          )}
        </div>

        <label htmlFor="p2p-pairing-url" style={{ display: 'block', fontSize: '0.78rem', color: '#6e7781', marginBottom: '0.4rem', fontWeight: 600 }}>
          配对链接
        </label>
        <input
          id="p2p-pairing-url"
          readOnly
          value={pairing.pairingUrl}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.62rem 0.7rem',
            border: '1px solid #d8dee4',
            borderRadius: 6,
            fontSize: '0.82rem',
            marginBottom: '0.85rem',
          }}
          onFocus={(event) => event.currentTarget.select()}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: '#6e7781', fontSize: '0.78rem' }}>
            有效期至 {new Date(pairing.offer.expiresAt).toLocaleTimeString('zh-CN')}
          </span>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(pairing.pairingUrl)}
            style={{
              padding: '0.5rem 0.9rem',
              border: '1px solid #0969da',
              borderRadius: 6,
              background: '#fff',
              color: '#0969da',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
}

function P2PConnectionScreen({
  state,
  error,
}: {
  state: 'connecting' | 'failed';
  error?: string;
}) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f6f8fa',
      color: '#24292f',
    }}>
      <div style={{
        width: 'min(420px, calc(100% - 2rem))',
        background: '#fff',
        border: '1px solid #d8dee4',
        borderRadius: 8,
        padding: '1.25rem',
        boxShadow: '0 8px 28px rgba(31,35,40,0.12)',
      }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.45rem' }}>
          {state === 'connecting' ? '正在连接 P2P' : 'P2P 连接失败'}
        </div>
        <div style={{ color: state === 'failed' ? '#cf222e' : '#57606a', fontSize: '0.86rem' }}>
          {state === 'failed' ? error ?? '无法建立 P2P 连接' : '正在通过 CodeRelay Signal 与电脑端建立 DataChannel。'}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [p2pState, setP2PState] = useState<
    | { state: 'idle' }
    | { state: 'connecting' }
    | { state: 'connected' }
    | { state: 'failed'; error: string }
  >({ state: 'idle' });
  const [pairingDialog, setPairingDialog] = useState<P2PPairingResponse | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [selectedSession, setSelectedSession] = useState<{
    projectId: string;
    sessionId: string;
  } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [abortSuccess, setAbortSuccess] = useState(false);
  const [alertDialog, setAlertDialog] = useState<{ title: string; message: string } | null>(null);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  // 已加载的项目列表(由 Sidebar 上报),用于把正确的项目名传给 Conversation 顶栏
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const [maxAgents, setMaxAgents] = useState(3);
  const initialPairingOfferRef = useRef(currentPairingOffer());
  const initialTrustedHostProfileRef = useRef(loadLastTrustedHostProfile());
  const p2pConnectStartedRef = useRef(false);
  const p2pSessionRef = useRef<BrowserP2PSession | null>(null);

  // 跟踪当前活跃 runId
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  // 续聊会话的活跃 runId 记录(sessionId → runId)。切走时只释放 SSE 连接、
  // 后台忙碌会话保活;切回同一会话时据此自动重连接管,无需再点"接管/继续"。
  const activeRunsRef = useRef<Map<string, string>>(new Map());
  const selectedSessionRef = useRef<{ projectId: string; sessionId: string } | null>(null);
  selectedSessionRef.current = selectedSession;

  // 各会话最近一次加载到的历史消息条数(由 Conversation 上报)
  const lastHistoryLenRef = useRef<Map<string, number>>(new Map());
  // 续聊起跑那刻锁定的历史边界(sessionId → 长度)。本轮输出会落盘进原 JSONL,
  // 切回时只渲染边界内历史 + 实时流全量重放,避免重复。一旦锁定不被后续增长覆盖。
  const [boundaries, setBoundaries] = useState<Map<string, number>>(new Map());

  const clearP2PTransport = useCallback(() => {
    p2pSessionRef.current?.close();
    p2pSessionRef.current = null;
    setChatTransport(null);
    setSessionTransport(null);
    setDiagnosticsTransport(null);
    setP2PState({ state: 'idle' });
    p2pConnectStartedRef.current = false;
    (window as unknown as { __coderelayTransportMode?: string }).__coderelayTransportMode = 'http';
  }, []);

  const clearAuthState = useCallback((client?: ApiClient | null) => {
    client?.disconnect();
    clearP2PTransport();
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('cc-web-activeRuns');
    activeRunsRef.current.clear();
    setApiClient(null);
    setRunId(null);
    setSelectedSession(null);
    window.history.pushState({}, '', window.location.pathname);
  }, [clearP2PTransport]);

  const installP2PTransport = useCallback((transport: CodeRelayTransport) => {
    setChatTransport(transport);
    setSessionTransport(transport);
    setDiagnosticsTransport(transport);
    (window as unknown as { __coderelayTransportMode?: string }).__coderelayTransportMode = 'p2p';
  }, []);

  const connectP2PWithToken = useCallback(async (token: string) => {
    const offer = initialPairingOfferRef.current ?? currentPairingOffer();
    const trustedHostProfile = offer ? null : initialTrustedHostProfileRef.current ?? loadLastTrustedHostProfile();
    if (!offer && !trustedHostProfile) {
      return false;
    }

    setP2PState({ state: 'connecting' });
    try {
      let session: BrowserP2PSession;
      if (offer) {
        session = await connectBrowserP2P(offer);
      } else if (trustedHostProfile) {
        session = await connectTrustedBrowserP2P(trustedHostProfile);
      } else {
        return false;
      }
      p2pSessionRef.current = session;
      installP2PTransport(session.transport);
      const client = createApiClient(token, () => clearAuthState(client), session.transport);
      setApiClient(client);
      setP2PState({ state: 'connected' });
      return true;
    } catch (error) {
      setP2PState({
        state: 'failed',
        error: error instanceof Error ? error.message : 'P2P 连接失败',
      });
      return false;
    }
  }, [clearAuthState, installP2PTransport]);

  const handleHistoryLoaded = useCallback((sessionId: string, length: number) => {
    lastHistoryLenRef.current.set(sessionId, length);
  }, []);

  const persistActiveRuns = useCallback(() => {
    try {
      const activeRunsObj: Record<string, string> = {};
      activeRunsRef.current.forEach((activeRunId, sid) => {
        activeRunsObj[sid] = activeRunId;
      });
      sessionStorage.setItem('cc-web-activeRuns', JSON.stringify(activeRunsObj));
    } catch {
      // sessionStorage 失败静默忽略
    }
  }, []);

  const rememberActiveRun = useCallback((sessionId: string, activeRunId: string) => {
    activeRunsRef.current.set(sessionId, activeRunId);
    persistActiveRuns();
  }, [persistActiveRuns]);

  const forgetActiveRun = useCallback((sessionId: string) => {
    if (!activeRunsRef.current.has(sessionId)) return;
    activeRunsRef.current.delete(sessionId);
    persistActiveRuns();
  }, [persistActiveRuns]);

  const forgetActiveRunByRunId = useCallback((staleRunId: string) => {
    let changed = false;
    activeRunsRef.current.forEach((activeRunId, sessionId) => {
      if (activeRunId === staleRunId) {
        activeRunsRef.current.delete(sessionId);
        changed = true;
      }
    });
    if (changed) {
      persistActiveRuns();
    }
  }, [persistActiveRuns]);

  const restoreActiveRun = useCallback(async (sessionId: string) => {
    const activeRunId = activeRunsRef.current.get(sessionId);
    if (!activeRunId) {
      if (selectedSessionRef.current?.sessionId === sessionId) {
        setRunId(null);
      }
      return;
    }

    // 本地已知的 active run 是用户刚刚接管过的可信状态。切回时先立刻
    // 打开 SSE 接管，探活只作为异步校验，避免把会话切换卡在一次 HTTP 请求上。
    if (selectedSessionRef.current?.sessionId === sessionId) {
      setRunId(activeRunId);
    }

    try {
      const alive = await probeRun(activeRunId);
      if (selectedSessionRef.current?.sessionId !== sessionId) {
        return;
      }
      if (alive) {
        return;
      }
    } catch {
      // 探活失败不等于 run 已死亡。保持乐观接管，让 SSE 自己完成重连/报错。
      return;
    }

    forgetActiveRun(sessionId);
    if (
      selectedSessionRef.current?.sessionId === sessionId &&
      runIdRef.current === activeRunId
    ) {
      setRunId(null);
    }
  }, [forgetActiveRun]);

  const { messages: liveMessages, pending, connected, error: liveError, status, model, effort, closed } = useSession(runId);
  const isAgentLimitReached = activeAgents.length >= maxAgents;
  const currentBackendRun = selectedSession
    ? activeAgents.find(
        (agent) =>
          agent.kind === 'continue' &&
          agent.sessionId === selectedSession.sessionId &&
          agent.projectId === selectedSession.projectId
      )
    : undefined;
  const canAttachOrContinue = Boolean(currentBackendRun) || !isAgentLimitReached;
  const connectionLabel = closed
    ? '已结束'
    : runId
      ? connected
        ? '已接管'
        : '连接中…'
      : currentBackendRun
        ? '后台运行中'
        : '未接管';

  const attachActiveAgent = useCallback((agent: ActiveAgent, source = 'active-list') => {
    clientLog('app.attach-active-agent', {
      source,
      runId: agent.runId,
      kind: agent.kind,
      sessionId: agent.sessionId ?? undefined,
      projectId: agent.projectId ?? undefined,
      status: agent.status,
    });

    if (agent.kind === 'continue' && agent.sessionId && agent.projectId) {
      const nextSelection = { projectId: agent.projectId, sessionId: agent.sessionId };
      selectedSessionRef.current = nextSelection;
      setSelectedSession(nextSelection);
      rememberActiveRun(agent.sessionId, agent.runId);
      setRunId(agent.runId);
      const params = new URLSearchParams();
      params.set('project', agent.projectId);
      params.set('session', agent.sessionId);
      window.history.pushState({}, '', `?${params.toString()}`);
      return;
    }

    setSelectedSession(null);
    selectedSessionRef.current = null;
    setRunId(agent.runId);
    window.history.pushState({}, '', window.location.pathname);
  }, [rememberActiveRun]);

  const refreshActiveAgents = useCallback(async () => {
    try {
      const result = await listActiveAgents();
      if (!areActiveAgentsEqual(activeAgents, result.agents)) {
        setActiveAgents(result.agents);
      }
      if (maxAgents !== result.maxConcurrent) {
        setMaxAgents(result.maxConcurrent);
      }
      clientLog('app.active-agents-refreshed', {
        count: result.agents.length,
        maxConcurrent: result.maxConcurrent,
        runIds: result.agents.map((agent) => agent.runId),
      });

      const currentSelection = selectedSessionRef.current;
      if (currentSelection && !runIdRef.current) {
        const matchingAgent = result.agents.find(
          (agent) =>
            agent.kind === 'continue' &&
            agent.sessionId === currentSelection.sessionId &&
            agent.projectId === currentSelection.projectId
        );
        if (matchingAgent) {
          attachActiveAgent(matchingAgent, 'auto-refresh');
        }
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        clearAuthState(apiClient);
      }
      // 活跃列表失败不阻塞主流程
    }
  }, [activeAgents, apiClient, attachActiveAgent, clearAuthState, maxAgents]);

  // 关闭/刷新页面时尽力关掉活跃会话
  useEffect(() => {
    const onUnload = () => {
      if (!runIdRef.current) return;
      if (
        selectedSession &&
        activeRunsRef.current.get(selectedSession.sessionId) === runIdRef.current &&
        status === 'idle'
      ) {
        forgetActiveRun(selectedSession.sessionId);
      }
      void closeSession(runIdRef.current);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [forgetActiveRun, selectedSession, status]);

  useEffect(() => {
    if (!apiClient) return;
    void refreshActiveAgents();
    const timer = window.setInterval(() => {
      void refreshActiveAgents();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [apiClient, refreshActiveAgents]);

  useEffect(() => {
    if (!apiClient) return;
    let cancelled = false;

    const heartbeatAll = async () => {
      const activeRunIds = new Set<string>();
      activeRunsRef.current.forEach((activeRunId) => {
        activeRunIds.add(activeRunId);
      });
      if (runIdRef.current) {
        activeRunIds.add(runIdRef.current);
      }
      if (activeRunIds.size === 0) return;

      await Promise.all(
        [...activeRunIds].map(async (activeRunId) => {
          try {
            await heartbeatSession(activeRunId);
          } catch (error) {
            if (cancelled) return;
            if (isUnauthorizedError(error)) {
              clearAuthState(apiClient);
              return;
            }
            if (isNotFoundError(error)) {
              forgetActiveRunByRunId(activeRunId);
              if (runIdRef.current === activeRunId) {
                setRunId(null);
              }
            }
          }
        })
      );
    };

    const timer = window.setInterval(() => {
      void heartbeatAll();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiClient, clearAuthState, forgetActiveRunByRunId]);

  // Restore session from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    const sessionId = params.get('session');
    if (projectId && sessionId) {
      const nextSelection = { projectId, sessionId };
      selectedSessionRef.current = nextSelection;
      setSelectedSession(nextSelection);

      // 尝试从 sessionStorage 恢复 activeRuns 并自动重连
      try {
        const stored = sessionStorage.getItem('cc-web-activeRuns');
        if (stored) {
          const activeRunsObj = JSON.parse(stored) as Record<string, string>;
          // 恢复到 ref
          Object.entries(activeRunsObj).forEach(([sid, rid]) => {
            activeRunsRef.current.set(sid, rid);
          });
          // 如果当前 session 有活跃 runId，直接恢复该 run 的 SSE 接管。
          // 这里不重复 startContinue：activeRuns 持久化的语义是“恢复现有活跃 run”，
          // 不是“重新创建一个 continue run”。
          const activeRunId = activeRunsObj[sessionId];
          if (activeRunId) {
            void restoreActiveRun(sessionId);
          }
        }
      } catch {
        // JSON 解析失败或其他错误，静默忽略，不影响正常渲染
      }
    }
  }, [restoreActiveRun]);

  const handleLogin = (token: string) => {
    sessionStorage.setItem('authToken', token);
    if (
      initialPairingOfferRef.current ??
      currentPairingOffer() ??
      initialTrustedHostProfileRef.current ??
      loadLastTrustedHostProfile()
    ) {
      p2pConnectStartedRef.current = true;
      void connectP2PWithToken(token);
      return;
    }

    const client = createApiClient(token, () => clearAuthState(client));
    setApiClient(client);
  };

  const handleSessionSelect = (projectId: string, sessionId: string) => {
    const matchingAgent = activeAgents.find(
      (agent) =>
        agent.kind === 'continue' &&
        agent.projectId === projectId &&
        agent.sessionId === sessionId
    );
    clientLog('app.session-select', {
      projectId,
      sessionId,
      activeCount: activeAgents.length,
      currentRunId: runIdRef.current,
      matchedRunId: matchingAgent?.runId,
    });
    if (matchingAgent) {
      setContinueError(null);
      attachActiveAgent(matchingAgent, 'history-row');
      return;
    }

    const nextSelection = { projectId, sessionId };
    selectedSessionRef.current = nextSelection;
    setSelectedSession(nextSelection);
    // 若此会话仍有活跃 run（切走时忙碌或空闲保活），先快速探活后恢复接管；
    // 若 run 已失效，则清理残留映射并回到未连接态等待手动继续。
    void restoreActiveRun(sessionId);
    setContinueError(null);
    // Update URL with session info
    const params = new URLSearchParams();
    params.set('project', projectId);
    params.set('session', sessionId);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const handleContinue = useCallback(async (sessionId: string, projectId?: string) => {
    setContinueError(null);
    try {
      const existingRun = activeAgents.find(
        (agent) =>
          agent.kind === 'continue' &&
          agent.sessionId === sessionId &&
          agent.projectId === projectId
      );
      if (existingRun) {
        clientLog('app.continue-existing-run', {
          sessionId,
          projectId,
          runId: existingRun.runId,
        });
        attachActiveAgent(existingRun, 'continue-button');
        return;
      }
      if (isAgentLimitReached) {
        throw new Error(`已达 ${maxAgents} 个后台运行上限，请先关闭一个`);
      }
      const id = await startContinue(sessionId, projectId);
      clientLog('app.continue-started', { sessionId, projectId, runId: id });
      rememberActiveRun(sessionId, id); // 记录活跃 runId,供切回/刷新重连

      // 锁定历史边界为起跑那刻已加载的历史长度;本轮输出由实时流负责,避免切回重复
      const len = lastHistoryLenRef.current.get(sessionId) ?? 0;
      setBoundaries((prev) => {
        const next = new Map(prev);
        next.set(sessionId, len);
        return next;
      });
      setRunId(id);
      await refreshActiveAgents();
    } catch (e) {
      // 原项目目录已删除等情况:续聊不可用,提示用户(历史浏览不受影响)
      setContinueError(e instanceof Error ? e.message : '续聊失败');
    }
  }, [activeAgents, attachActiveAgent, isAgentLimitReached, maxAgents, rememberActiveRun, refreshActiveAgents]);

  const handleNew = useCallback(() => {
    setNewSessionDialogOpen(true);
  }, []);

  const handleNewWithCwd = useCallback(async (cwd: string) => {
    try {
      if (isAgentLimitReached) {
        throw new Error(`已达 ${maxAgents} 个后台运行上限，请先关闭一个`);
      }
      const id = await startNew(cwd || undefined);
      clientLog('app.new-started', { runId: id, cwd: cwd || undefined, source: 'quick' });
      setRunId(id);
      setSelectedSession(null);
      selectedSessionRef.current = null;
      window.history.pushState({}, '', window.location.pathname);
      await refreshActiveAgents();
    } catch (e) {
      setAlertDialog({
        title: '新建失败',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [isAgentLimitReached, maxAgents, refreshActiveAgents]);

  const handleSend = useCallback(
    async (text: string, attachments: string[]) => {
      if (!runId) return;
      // 服务端回显为准:发送后由后端 emit user_message 进事件流,
      // 实时显示自己的提问,且重连(整段重放)后仍能看到。
      await sendMessage(runId, { text, attachments });
    },
    [runId]
  );

  const handleAnswer = useCallback(
    async (answer: PromptAnswer) => {
      if (!runId) return;
      clientLog('app.respond-click', {
        runId,
        promptId: answer.id,
        kind: answer.kind,
        decision:
          answer.kind === 'permission' || answer.kind === 'plan'
            ? answer.decision
            : undefined,
      });
      try {
        await respond(runId, answer);
        clientLog('app.respond-success', {
          runId,
          promptId: answer.id,
          kind: answer.kind,
        });
      } catch (e) {
        clientLog('app.respond-failed', {
          runId,
          promptId: answer.id,
          kind: answer.kind,
          message: e instanceof Error ? e.message : String(e),
        });
        setAlertDialog({
          title: '操作未生效',
          message:
            e instanceof Error
              ? e.message
              : '待处理卡片已失效，请刷新当前会话状态后重试',
        });
      }
    },
    [runId]
  );

  const handleAbort = useCallback(async () => {
    if (!runId) return;
    try {
      await abortSession(runId);
      setAbortSuccess(true);
      await refreshActiveAgents();
      // 3秒后自动隐藏提示
      setTimeout(() => setAbortSuccess(false), 3000);
    } catch (e) {
      console.error('Abort failed:', e);
    }
  }, [refreshActiveAgents, runId]);

  const handleSelectActiveAgent = useCallback((agent: ActiveAgent) => {
    attachActiveAgent(agent, 'active-list');
  }, [attachActiveAgent]);

  const handleCloseActiveAgent = useCallback(async (agent: ActiveAgent) => {
    try {
      await closeAgent(agent.runId);
      if (agent.kind === 'continue' && agent.sessionId) {
        forgetActiveRun(agent.sessionId);
      }
      if (runIdRef.current === agent.runId) {
        setRunId(null);
      }
      await refreshActiveAgents();
    } catch (e) {
      setAlertDialog({
        title: '关闭失败',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [forgetActiveRun, refreshActiveAgents]);

  const handleLogout = useCallback(() => {
    clearAuthState(apiClient);
  }, [apiClient, clearAuthState]);

  const handleOpenPairing = useCallback(async () => {
    if (!apiClient) return;
    setPairingBusy(true);
    try {
      setPairingDialog(await apiClient.openP2PPairing());
    } catch (error) {
      setAlertDialog({
        title: '添加设备失败',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPairingBusy(false);
    }
  }, [apiClient]);

  useEffect(() => {
    if (
      closed &&
      runId &&
      selectedSession &&
      activeRunsRef.current.get(selectedSession.sessionId) === runId
    ) {
      forgetActiveRun(selectedSession.sessionId);
      setRunId(null);
    }
  }, [closed, forgetActiveRun, runId, selectedSession]);

  // Try to restore session from sessionStorage
  if (!apiClient) {
    const storedToken = sessionStorage.getItem('authToken');
    if (storedToken) {
      if (
        initialPairingOfferRef.current ??
        currentPairingOffer() ??
        initialTrustedHostProfileRef.current ??
        loadLastTrustedHostProfile()
      ) {
        if (!p2pConnectStartedRef.current && p2pState.state === 'idle') {
          p2pConnectStartedRef.current = true;
          void connectP2PWithToken(storedToken);
        }
        if (p2pState.state === 'failed') {
          return <P2PConnectionScreen state="failed" error={p2pState.error} />;
        }
        return <P2PConnectionScreen state="connecting" />;
      }
      const client = createApiClient(storedToken, () => clearAuthState(client));
      setApiClient(client);
    } else {
      return <Login onLogin={handleLogin} />;
    }
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
    }}>
      <MobileMenu>
        <div className="sidebar-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Sidebar
              apiClient={apiClient!}
              onSessionSelect={handleSessionSelect}
              selectedSessionId={selectedSession?.sessionId}
              onNewSession={handleNew}
              onQuickNewSession={handleNewWithCwd}
              onProjectsLoad={setProjects}
              activeAgents={activeAgents}
              maxAgents={maxAgents}
              currentRunId={runId}
              currentRunConnected={connected}
              onActiveAgentSelect={handleSelectActiveAgent}
              onActiveAgentClose={handleCloseActiveAgent}
            />
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.75rem 1rem',
            borderTop: '1px solid #eee',
            backgroundColor: '#fafafa',
            flexDirection: 'column',
            gap: '0.5rem',
          }}>
            <div style={{
              width: '100%',
              padding: '0.45rem 0.65rem',
              boxSizing: 'border-box',
              borderRadius: 6,
              border: p2pState.state === 'connected'
                ? '1px solid #1f883d33'
                : p2pState.state === 'failed'
                  ? '1px solid #d1242f33'
                  : '1px solid #d0d7de',
              background: p2pState.state === 'connected'
                ? '#1f883d12'
                : p2pState.state === 'failed'
                  ? '#d1242f12'
                  : '#fff',
              color: p2pState.state === 'connected'
                ? '#1f883d'
                : p2pState.state === 'failed'
                  ? '#d1242f'
                  : '#57606a',
              fontSize: '0.78rem',
              fontWeight: 650,
              textAlign: 'center',
            }}>
              {p2pState.state === 'connected'
                ? '协议：P2P'
                : p2pState.state === 'connecting'
                  ? '协议：P2P 连接中'
                  : p2pState.state === 'failed'
                    ? '协议：HTTP（P2P 失败）'
                    : '协议：HTTP'}
            </div>
            {p2pState.state === 'connected' && (
              <div style={{
                width: '100%',
                padding: '0.45rem 0.65rem',
                boxSizing: 'border-box',
                borderRadius: 6,
                border: '1px solid #1f883d33',
                background: '#1f883d12',
                color: '#1f883d',
                fontSize: '0.78rem',
                fontWeight: 650,
                textAlign: 'center',
              }}>
                P2P 已连接
              </div>
            )}
            <button
              onClick={handleOpenPairing}
              disabled={pairingBusy}
              style={{
                width: '100%',
                padding: '0.625rem 1rem',
                borderRadius: 8,
                border: '1px solid #0969da',
                background: pairingBusy ? '#eaeef2' : '#fff',
                color: pairingBusy ? '#6a737d' : '#0969da',
                cursor: pairingBusy ? 'not-allowed' : 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              添加设备
            </button>
            <button
              onClick={handleLogout}
              style={{
                width: '100%',
                padding: '0.625rem 1rem',
                borderRadius: 8,
                border: '1px solid #dc3545',
                background: '#fff',
                color: '#dc3545',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600,
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#dc3545';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
                e.currentTarget.style.color = '#dc3545';
              }}
            >
              <span>🚪</span>
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </MobileMenu>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selectedSession || runId ? (
          <>
            {/* 续聊控制条:连接状态 + 接管/新建入口 */}
            <div className="status-bar" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 1rem',
              borderBottom: '1px solid #eee',
              backgroundColor: '#fafafa',
              fontSize: '0.85rem',
            }}>
              {/* 移动端菜单按钮 */}
              <button
                className="mobile-menu-button-header"
                onClick={() => {
                  if ((window as any).__toggleMobileMenu) {
                    (window as any).__toggleMobileMenu();
                  }
                }}
                aria-label="菜单"
                style={{
                  display: 'none', // 默认隐藏，移动端 CSS 会显示
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  padding: '0.25rem',
                  color: '#666',
                }}
              >
                ☰
              </button>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: runId && connected ? '#1f883d' : currentBackendRun ? '#0969da' : '#999',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: runId && connected ? '#1f883d' : currentBackendRun ? '#0969da' : '#bbb',
                }} />
                {connectionLabel}
              </span>
              {runId && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  color: status === 'executing' ? '#9a6700' : status === 'waiting' ? '#0969da' : '#666',
                }}>
                  {status === 'executing' ? '执行中…' : status === 'waiting' ? '等待你回答' : '空闲'}
                </span>
              )}
              {runId && (
                <span style={{ color: '#888' }}>
                  模型: {model ?? '未知'}
                </span>
              )}
              {runId && effort && (
                <span style={{ color: '#888' }}>
                  强度: {effort}
                </span>
              )}
              {liveError && <span style={{ color: '#cf222e' }}>错误: {liveError}</span>}
              {continueError && <span style={{ color: '#cf222e' }}>{continueError}</span>}
              {!continueError && selectedSession && !runId && !currentBackendRun && isAgentLimitReached && (
                <span style={{ color: '#cf222e' }}>已达 {maxAgents} 个后台运行上限，请先关闭一个</span>
              )}
              {abortSuccess && <span style={{ color: '#1f883d', fontWeight: 500 }}>✓ 已停止</span>}
              <span style={{ flex: 1 }} />
              {selectedSession && !runId && !continueError && (
                <button
                  disabled={!canAttachOrContinue}
                  onClick={() => handleContinue(selectedSession.sessionId, selectedSession.projectId)}
                  style={{
                    padding: '0.35rem 0.9rem', borderRadius: 6, border: '1px solid #1976d2',
                    background: canAttachOrContinue ? '#fff' : '#eaeef2',
                    color: canAttachOrContinue ? '#1976d2' : '#6a737d',
                    cursor: canAttachOrContinue ? 'pointer' : 'not-allowed',
                  }}
                >
                  {currentBackendRun ? '接管后台运行' : '接管/继续'}
                </button>
              )}
            </div>

            <div
              data-testid="session-content"
              style={{ flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: '#fff' }}
            >
              {selectedSession ? (
                <Conversation
                  apiClient={apiClient!}
                  projectId={selectedSession.projectId}
                  sessionId={selectedSession.sessionId}
                  projectName={projects.find(p => p.id === selectedSession.projectId)?.name}
                  projectPath={projects.find(p => p.id === selectedSession.projectId)?.path}
                  liveMessages={runId ? liveMessages : undefined}
                  historyBoundary={runId ? boundaries.get(selectedSession.sessionId) : undefined}
                  onHistoryLoaded={handleHistoryLoaded}
                  pending={runId ? pending : null}
                  onAnswer={runId ? handleAnswer : undefined}
                />
              ) : (
                // 纯新建会话(无历史 session):只展示实时流
                <NewSessionView
                  liveMessages={liveMessages}
                  pending={pending}
                  onAnswer={handleAnswer}
                />
              )}
            </div>

            {runId && (
              <Composer
                disabled={!connected}
                executing={status === 'executing'}
                onSend={handleSend}
                onAbort={handleAbort}
              />
            )}
          </>
        ) : (
          <>
            {/* 空状态页也有状态栏（包含汉堡菜单） */}
            <div className="status-bar" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 1rem',
              borderBottom: '1px solid #eee',
              backgroundColor: '#fafafa',
              fontSize: '0.85rem',
            }}>
              {/* 移动端菜单按钮 */}
              <button
                className="mobile-menu-button-header"
                onClick={() => {
                  if ((window as any).__toggleMobileMenu) {
                    (window as any).__toggleMobileMenu();
                  }
                }}
                aria-label="菜单"
                style={{
                  display: 'none',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: '1.5rem',
                  padding: '0.25rem',
                  color: '#666',
                }}
              >
                ☰
              </button>
              <span style={{ color: '#999', fontSize: '0.875rem' }}>未选择会话</span>
            </div>

            <div style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f5f5f5',
            }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '1rem',
              opacity: 0.3,
            }}>
              💬
            </div>
            <div style={{
              fontSize: '1.125rem',
              color: '#999',
              marginBottom: '0.5rem',
            }}>
              未选择会话
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#bbb',
              marginBottom: '1rem',
            }}>
              从左侧选择一个会话开始查看,或新建对话
            </div>
            <button
              onClick={handleNew}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: 8, border: '1px solid #1976d2',
                background: '#1976d2', color: '#fff', cursor: 'pointer',
              }}
            >
              ＋ 新建对话
            </button>
          </div>
          </>
        )}
      </div>
      <NewSessionDialog
        open={newSessionDialogOpen}
        projects={projects}
        onCreate={handleNewWithCwd}
        onClose={() => setNewSessionDialogOpen(false)}
      />
      <AlertDialog
        open={alertDialog !== null}
        title={alertDialog?.title || ''}
        message={alertDialog?.message || ''}
        onClose={() => setAlertDialog(null)}
      />
      <PairingDialog
        pairing={pairingDialog}
        onClose={() => setPairingDialog(null)}
      />
    </div>
  );
}

export default App;
