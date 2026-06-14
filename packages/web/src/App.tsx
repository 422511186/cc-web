import { useState, useEffect, useCallback } from 'react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { MobileMenu } from './components/MobileMenu';
import { Composer } from './components/Composer';
import { useSession } from './useSession';
import { startNew, startContinue, sendMessage, respond } from './chatApi';
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

  const { messages: liveMessages, pending, connected, error: liveError } = useSession(runId);

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
    setSelectedSession({ projectId, sessionId });
    // 切换会话时清空活跃续聊状态(下次点"继续"再接管)
    setRunId(null);
    // Update URL with session info
    const params = new URLSearchParams();
    params.set('project', projectId);
    params.set('session', sessionId);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

  const handleContinue = useCallback(async (sessionId: string) => {
    const id = await startContinue(sessionId);
    setRunId(id);
  }, []);

  const handleNew = useCallback(async () => {
    const id = await startNew();
    setRunId(id);
    setSelectedSession(null);
  }, []);

  const handleSend = useCallback(
    async (text: string, attachments: string[]) => {
      if (!runId) return;
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
        <div className="sidebar-container">
          <Sidebar
            apiClient={apiClient!}
            onSessionSelect={handleSessionSelect}
            selectedSessionId={selectedSession?.sessionId}
          />
        </div>
      </MobileMenu>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selectedSession || runId ? (
          <>
            {/* 续聊控制条:连接状态 + 接管/新建入口 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 1rem',
              borderBottom: '1px solid #eee',
              backgroundColor: '#fafafa',
              fontSize: '0.85rem',
            }}>
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
              {liveError && <span style={{ color: '#cf222e' }}>错误: {liveError}</span>}
              <span style={{ flex: 1 }} />
              {selectedSession && !runId && (
                <button
                  onClick={() => handleContinue(selectedSession.sessionId)}
                  style={{
                    padding: '0.35rem 0.9rem', borderRadius: 6, border: '1px solid #1976d2',
                    background: '#fff', color: '#1976d2', cursor: 'pointer',
                  }}
                >
                  🔗 在此继续
                </button>
              )}
              <button
                onClick={handleNew}
                style={{
                  padding: '0.35rem 0.9rem', borderRadius: 6, border: '1px solid #ddd',
                  background: '#fff', cursor: 'pointer',
                }}
              >
                ＋ 新建对话
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
              {selectedSession ? (
                <Conversation
                  apiClient={apiClient!}
                  projectId={selectedSession.projectId}
                  sessionId={selectedSession.sessionId}
                  liveMessages={runId ? liveMessages : undefined}
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
              <Composer disabled={!connected} onSend={handleSend} />
            )}
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
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
        )}
      </div>
    </div>
  );
}

export default App;
