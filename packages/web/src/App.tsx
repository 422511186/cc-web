import { useState, useEffect, useCallback, useRef } from 'react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { MobileMenu } from './components/MobileMenu';
import { Composer } from './components/Composer';
import { AlertDialog } from './components/AlertDialog';
import { useSession } from './useSession';
import { startNew, startContinue, sendMessage, respond, closeSession, abortSession } from './chatApi';
import { createApiClient } from './api';
import type { ApiClient } from './api';
import type { PromptAnswer, PendingPrompt } from '@cc-web/shared';
import type { LiveMessage } from './useSession';
import { QuestionCard } from './components/QuestionCard';
import { PermissionCard } from './components/PermissionCard';
import { PlanCard } from './components/PlanCard';
import { marked } from 'marked';

/** 纯新建会话视图:无历史 session,只展示实时流式消息与待答卡片 */
function NewSessionView({ liveMessages, pending, onAnswer }: {
  liveMessages: LiveMessage[];
  pending: PendingPrompt | null;
  onAnswer: (a: PromptAnswer) => void;
}) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '1.5rem' }}>
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
                  return (
                    <div
                      key={bi}
                      className="markdown-content"
                      style={{ lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: marked.parse(b.text, { async: false }) as string }}
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

function App() {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [selectedSession, setSelectedSession] = useState<{
    projectId: string;
    sessionId: string;
  } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [abortSuccess, setAbortSuccess] = useState(false);
  const [alertDialog, setAlertDialog] = useState<{ title: string; message: string } | null>(null);

  // 跟踪当前活跃 runId,供切换/卸载时主动释放旧会话(忙碌则后台保活待重连)
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  // 续聊会话的活跃 runId 记录(sessionId → runId)。切走时只释放 SSE 连接、
  // 后台忙碌会话保活;切回同一会话时据此自动重连接管,无需再点"在此继续"。
  const activeRunsRef = useRef<Map<string, string>>(new Map());

  // 各会话最近一次加载到的历史消息条数(由 Conversation 上报)
  const lastHistoryLenRef = useRef<Map<string, number>>(new Map());
  // 续聊起跑那刻锁定的历史边界(sessionId → 长度)。本轮输出会落盘进原 JSONL,
  // 切回时只渲染边界内历史 + 实时流全量重放,避免重复。一旦锁定不被后续增长覆盖。
  const [boundaries, setBoundaries] = useState<Map<string, number>>(new Map());

  const handleHistoryLoaded = useCallback((sessionId: string, length: number) => {
    lastHistoryLenRef.current.set(sessionId, length);
  }, []);

  // 释放上一个活跃会话(若有):忙碌则后台保活,空闲则回收
  const closePrevious = useCallback(() => {
    const prev = runIdRef.current;
    if (prev) void closeSession(prev);
  }, []);

  // 关闭/刷新页面时尽力关掉活跃会话
  useEffect(() => {
    const onUnload = () => {
      if (runIdRef.current) void closeSession(runIdRef.current);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const { messages: liveMessages, pending, connected, error: liveError, status, model, effort } = useSession(runId);

  // Restore session from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    const sessionId = params.get('session');
    if (projectId && sessionId) {
      setSelectedSession({ projectId, sessionId });
    }
  }, []);

  const handleLogin = (token: string) => {
    const client = createApiClient(token);
    setApiClient(client);
    // Store token in sessionStorage for reload persistence
    sessionStorage.setItem('authToken', token);
  };

  const handleSessionSelect = (projectId: string, sessionId: string) => {
    closePrevious(); // 切换会话:释放旧会话(忙碌则后台保活待重连)
    setSelectedSession({ projectId, sessionId });
    // 切换会话时总是清空 runId，强制用户手动点"在此继续"，避免自动恢复旧连接导致状态混乱
    setRunId(null);
    setContinueError(null);
    // Update URL with session info
    const params = new URLSearchParams();
    params.set('project', projectId);
    params.set('session', sessionId);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const handleContinue = useCallback(async (sessionId: string, projectId?: string) => {
    closePrevious(); // 续聊前释放旧会话(忙碌则后台保活)
    setContinueError(null);
    try {
      const id = await startContinue(sessionId, projectId);
      activeRunsRef.current.set(sessionId, id); // 记录活跃 runId,供切回重连
      // 锁定历史边界为起跑那刻已加载的历史长度;本轮输出由实时流负责,避免切回重复
      const len = lastHistoryLenRef.current.get(sessionId) ?? 0;
      setBoundaries((prev) => {
        const next = new Map(prev);
        next.set(sessionId, len);
        return next;
      });
      setRunId(id);
    } catch (e) {
      // 原项目目录已删除等情况:续聊不可用,提示用户(历史浏览不受影响)
      setContinueError(e instanceof Error ? e.message : '续聊失败');
    }
  }, [closePrevious]);

  const handleNew = useCallback(async () => {
    closePrevious(); // 新建前关掉旧的活跃会话

    // 弹出目录输入框
    const cwd = window.prompt('请输入工作目录路径（留空则使用默认）:', '');
    if (cwd === null) return; // 用户取消

    try {
      const id = await startNew(cwd || undefined);
      setRunId(id);
      setSelectedSession(null);
    } catch (e) {
      setAlertDialog({
        title: '新建失败',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [closePrevious]);

  const handleNewWithCwd = useCallback(async (cwd: string) => {
    closePrevious(); // 新建前关掉旧的活跃会话
    try {
      const id = await startNew(cwd || undefined);
      setRunId(id);
      setSelectedSession(null);
    } catch (e) {
      setAlertDialog({
        title: '新建失败',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [closePrevious]);

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
      await respond(runId, answer);
    },
    [runId]
  );

  const handleAbort = useCallback(async () => {
    if (!runId) return;
    try {
      await abortSession(runId);
      setAbortSuccess(true);
      // 3秒后自动隐藏提示
      setTimeout(() => setAbortSuccess(false), 3000);
    } catch (e) {
      console.error('Abort failed:', e);
    }
  }, [runId]);

  const handleLogout = useCallback(() => {
    closePrevious(); // 登出前关掉活跃会话
    sessionStorage.removeItem('authToken');
    setApiClient(null);
    setRunId(null);
    setSelectedSession(null);
    window.history.pushState({}, '', window.location.pathname);
  }, [closePrevious]);

  // Try to restore session from sessionStorage
  if (!apiClient) {
    const storedToken = sessionStorage.getItem('authToken');
    if (storedToken) {
      setApiClient(createApiClient(storedToken));
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
              onNewSession={handleNewWithCwd}
            />
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.75rem 1rem',
            borderTop: '1px solid #eee',
            backgroundColor: '#fafafa',
          }}>
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
                color: connected ? '#1f883d' : '#999',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: connected ? '#1f883d' : '#bbb',
                }} />
                {connected ? '已连接' : runId ? '连接中…' : '未连接'}
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
              {abortSuccess && <span style={{ color: '#1f883d', fontWeight: 500 }}>✓ 已停止</span>}
              <span style={{ flex: 1 }} />
              {selectedSession && !runId && !continueError && (
                <button
                  onClick={() => handleContinue(selectedSession.sessionId, selectedSession.projectId)}
                  style={{
                    padding: '0.35rem 0.9rem', borderRadius: 6, border: '1px solid #1976d2',
                    background: '#fff', color: '#1976d2', cursor: 'pointer',
                  }}
                >
                  🔗 在此继续
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
              {selectedSession ? (
                <Conversation
                  apiClient={apiClient!}
                  projectId={selectedSession.projectId}
                  sessionId={selectedSession.sessionId}
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
      <AlertDialog
        open={alertDialog !== null}
        title={alertDialog?.title || ''}
        message={alertDialog?.message || ''}
        onClose={() => setAlertDialog(null)}
      />
    </div>
  );
}

export default App;
