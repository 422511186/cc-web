import { useState, useEffect, useCallback } from 'react';
import type { SessionDetail, Message, PendingPrompt, PromptAnswer } from '@cc-web/shared';
import type { ApiClient } from '../api';
import type { LiveMessage } from '../useSession';
import { QuestionCard } from './QuestionCard';
import { PermissionCard } from './PermissionCard';
import { PlanCard } from './PlanCard';
import { marked } from 'marked';
import '../markdown.css';

interface ConversationProps {
  apiClient: ApiClient;
  projectId: string;
  sessionId: string;
  /** 实时续聊:已累积的流式消息 */
  liveMessages?: LiveMessage[];
  /** 当前待答事项(权限/答题/计划) */
  pending?: PendingPrompt | null;
  /** 用户对待答事项的回答回调 */
  onAnswer?: (a: PromptAnswer) => void;
}

/** 实时块的轻量折叠展示(thinking / tool_use / tool_result) */
function LiveCollapsible({ summary, body }: { summary: string; body: string }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div style={{
      marginBottom: '0.5rem',
      borderRadius: '6px',
      backgroundColor: '#fafafa',
      overflow: 'hidden',
      border: '1px solid #e8e8e8',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '0.6rem 0.9rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          color: '#555',
          userSelect: 'none',
          backgroundColor: 'rgba(0,0,0,0.02)',
        }}
      >
        <span style={{
          transform: collapsed ? 'none' : 'rotate(90deg)',
          transition: 'transform 0.2s',
          fontSize: '0.75rem',
        }}>▸</span>
        <span style={{ flex: 1 }}>{summary}</span>
      </div>
      {!collapsed && (
        <pre style={{
          margin: 0,
          padding: '0.9rem',
          borderTop: '1px solid #e8e8e8',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'monospace',
          color: '#444',
          backgroundColor: '#fff',
        }}>{body}</pre>
      )}
    </div>
  );
}

/** 把工具入参压成一行摘要 */
function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.command === 'string') return o.command;
    if (typeof o.file_path === 'string') return o.file_path;
    if (typeof o.path === 'string') return o.path;
  }
  try { return JSON.stringify(input).slice(0, 60); } catch { return ''; }
}

// A small image attachment thumbnail (chat-bubble style). Clicking opens the lightbox.
function ImageThumbnail({ src, alt, onClick }: { src: string; alt: string; onClick: () => void }) {
  return (
    <img
      src={src}
      alt={alt}
      onClick={onClick}
      style={{
        height: '72px',
        width: '72px',
        objectFit: 'cover',
        borderRadius: '8px',
        cursor: 'pointer',
        border: '1px solid rgba(0,0,0,0.12)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
      }}
    />
  );
}

function MessageContent({ content, role, metadata, apiClient, onImageClick }: {
  content: string;
  role: string;
  metadata?: any;
  apiClient?: ApiClient;
  onImageClick?: (src: string, alt: string) => void;
}) {
  // For assistant messages, render as markdown
  if (role === 'assistant') {
    const html = marked.parse(content, { async: false }) as string;
    return (
      <>
        <div
          dangerouslySetInnerHTML={{ __html: html }}
          style={{
            lineHeight: '1.6',
          }}
          className="markdown-content"
        />
      </>
    );
  }

  // For user messages, render as plain text with images/documents
  return (
    <>
      {/* Image attachments referenced by local path ([Image: source: ...]) */}
      {apiClient && metadata?.imagePaths && metadata.imagePaths.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {metadata.imagePaths.map((p: string, idx: number) => {
            const src = apiClient.imageUrl(p);
            const alt = `Image ${idx + 1}`;
            return (
              <ImageThumbnail
                key={`path-${idx}`}
                src={src}
                alt={alt}
                onClick={() => onImageClick?.(src, alt)}
              />
            );
          })}
        </div>
      )}

      {/* Display inline base64 images */}
      {metadata?.images && metadata.images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {metadata.images.map((img: any, idx: number) => {
            const src = `data:${img.source.media_type};base64,${img.source.data}`;
            const alt = `Image ${idx + 1}`;
            return (
              <ImageThumbnail
                key={`b64-${idx}`}
                src={src}
                alt={alt}
                onClick={() => onImageClick?.(src, alt)}
              />
            );
          })}
        </div>
      )}

      {/* Display documents */}
      {metadata?.documents && metadata.documents.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          {metadata.documents.map((doc: any, idx: number) => (
            <div
              key={idx}
              style={{
                padding: '0.5rem',
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: '4px',
                marginBottom: '0.5rem',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (doc.source) {
                  // Open document in new window
                  const win = window.open();
                  if (win) {
                    const blob = new Blob([atob(doc.source.data)], { type: doc.source.media_type });
                    const url = URL.createObjectURL(blob);
                    win.location.href = url;
                  }
                }
              }}
            >
              📄 Document {idx + 1} {doc.source?.media_type && `(${doc.source.media_type})`}
            </div>
          ))}
        </div>
      )}

      {/* Display text content */}
      {content && <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>}
    </>
  );
}

function CollapsibleMessage({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(true);

  const getIcon = () => {
    switch (message.type) {
      case 'thinking': return '💭';
      case 'tool_use': return '🔧';
      case 'tool_result': return '✓';
      case 'system_message': return '⚙️';
      default: return '▸';
    }
  };

  const getSummary = () => {
    switch (message.type) {
      case 'thinking':
        return 'Thinking...';
      case 'tool_use':
        return `${message.metadata?.toolName || 'Tool'}`;
      case 'tool_result':
        const status = message.metadata?.isError ? '✗ Error' : '✓ Success';
        return `${status}`;
      case 'system_message':
        return 'System message';
      default:
        return message.content.substring(0, 50);
    }
  };

  const getBackgroundColor = () => {
    if (message.type === 'tool_result' && message.metadata?.isError) {
      return '#fff5f5';
    }
    return '#fafafa';
  };

  return (
    <div style={{
      marginBottom: '0.5rem',
      borderRadius: '6px',
      backgroundColor: getBackgroundColor(),
      overflow: 'hidden',
      border: '1px solid #e8e8e8',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '0.75rem 1rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.875rem',
          color: '#666',
          userSelect: 'none',
          backgroundColor: 'rgba(0,0,0,0.02)',
        }}
      >
        <span style={{
          transform: collapsed ? 'none' : 'rotate(90deg)',
          transition: 'transform 0.2s',
          fontSize: '0.75rem',
        }}>
          ▸
        </span>
        <span style={{ fontSize: '1rem' }}>{getIcon()}</span>
        <span style={{ flex: 1, color: '#333' }}>{getSummary()}</span>
        {message.metadata?.toolName && (
          <span style={{ fontSize: '0.75rem', color: '#999' }}>
            {message.metadata.toolName}
          </span>
        )}
      </div>
      {!collapsed && (
        <div style={{
          padding: '1rem',
          borderTop: '1px solid #e8e8e8',
          fontSize: '0.875rem',
          whiteSpace: 'pre-wrap',
          fontFamily: message.type === 'tool_use' || message.type === 'tool_result' ? 'monospace' : 'inherit',
          color: '#444',
          lineHeight: '1.6',
          backgroundColor: '#fff',
        }}>
          {message.type === 'tool_use' && message.metadata?.toolInput ? (
            <>
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#333' }}>Input:</div>
              <pre style={{ margin: 0, fontSize: '0.8rem', overflow: 'auto', color: '#666' }}>
                {JSON.stringify(message.metadata.toolInput, null, 2)}
              </pre>
            </>
          ) : (
            message.content
          )}
        </div>
      )}
    </div>
  );
}

export function Conversation({ apiClient, projectId, sessionId, liveMessages, pending, onAnswer }: ConversationProps) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserMessageIndex, setCurrentUserMessageIndex] = useState<number>(0);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const messageRefs = useState<(HTMLDivElement | null)[]>([])[0];

  // Extract project name from projectId (e.g., "C--Users-huang-workspace-cc-web" -> "cc-web")
  const projectName = projectId.split('-').filter(Boolean).pop() || projectId;

  const loadSession = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.getSession(projectId, sessionId);
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [apiClient, projectId, sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Setup SSE connection for real-time updates - incremental update only
  useEffect(() => {
    const cleanup = apiClient.connectSSE(async (update) => {
      // Only update if it's for the current session
      if (update.projectId === projectId && update.sessionId === sessionId) {
        console.log('Session updated, fetching new messages...');
        try {
          const response = await apiClient.getSession(projectId, sessionId);

          setSession(prevSession => {
            if (!prevSession) {
              // First load, set everything
              return response.session;
            }

            // Check if there are new messages
            if (response.session.messages.length > prevSession.messages.length) {
              console.log(`Appending ${response.session.messages.length - prevSession.messages.length} new messages`);
              // Return the new session with all messages (including new ones)
              return response.session;
            } else if (response.session.messages.length === prevSession.messages.length) {
              // Same length - check if last message changed (still being written)
              const lastOldMsg = prevSession.messages[prevSession.messages.length - 1];
              const lastNewMsg = response.session.messages[response.session.messages.length - 1];

              if (lastOldMsg && lastNewMsg && lastOldMsg.content !== lastNewMsg.content) {
                console.log('Last message updated (streaming)');
                return response.session;
              }
            }

            // No changes, keep previous
            return prevSession;
          });
        } catch (err) {
          console.error('Failed to fetch session update:', err);
        }
      }
    });

    return cleanup;
  }, [apiClient, projectId, sessionId]);

  useEffect(() => {
    if (session) {
      // Find user messages (only text messages, not tool_result or system_message)
      const userMessageIndices = session.messages
        .map((msg, idx) => ({ msg, idx }))
        .filter(({ msg }) => msg.role === 'user' && (!msg.type || msg.type === 'text'))
        .map(({ idx }) => idx);

      // Initialize to last user message
      if (userMessageIndices.length > 0) {
        const lastIndex = userMessageIndices.length - 1;
        setCurrentUserMessageIndex(lastIndex);
        // Scroll to bottom (last message) after a brief delay to ensure DOM is ready
        setTimeout(() => {
          scrollToMessage(session.messages.length - 1);
        }, 100);
      }
    }
  }, [session]);

  const getUserMessageIndices = () => {
    if (!session) return [];
    return session.messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.role === 'user' && (!msg.type || msg.type === 'text'))
      .map(({ idx }) => idx);
  };

  const scrollToMessage = (messageIndex: number) => {
    const messageElement = messageRefs[messageIndex];
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const goToTop = () => {
    // Scroll to very first message (any role)
    if (session && session.messages.length > 0) {
      scrollToMessage(0);
      // Update current user message index to first user message
      const userIndices = getUserMessageIndices();
      if (userIndices.length > 0) {
        setCurrentUserMessageIndex(0);
      }
    }
  };

  const goToBottom = () => {
    // Scroll to very last message (any role)
    if (session && session.messages.length > 0) {
      scrollToMessage(session.messages.length - 1);
      // Update current user message index to last user message
      const userIndices = getUserMessageIndices();
      if (userIndices.length > 0) {
        setCurrentUserMessageIndex(userIndices.length - 1);
      }
    }
  };

  const goToPrevious = () => {
    const userIndices = getUserMessageIndices();
    if (currentUserMessageIndex > 0) {
      const newIndex = currentUserMessageIndex - 1;
      setCurrentUserMessageIndex(newIndex);
      scrollToMessage(userIndices[newIndex]);
    }
  };

  const goToNext = () => {
    const userIndices = getUserMessageIndices();
    if (currentUserMessageIndex < userIndices.length - 1) {
      const newIndex = currentUserMessageIndex + 1;
      setCurrentUserMessageIndex(newIndex);
      scrollToMessage(userIndices[newIndex]);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        Loading conversation...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: '#d32f2f' }}>
        Error: {error}
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        No conversation selected
      </div>
    );
  }

  const isCollapsible = (msg: Message) =>
    msg.type && ['thinking', 'tool_use', 'tool_result', 'system_message'].includes(msg.type);

  const userMessageIndices = getUserMessageIndices();
  const userMessageCount = userMessageIndices.length;

  // Virtual list for navigation dots - only show a window of dots around current position
  const MAX_VISIBLE_DOTS = 7; // Show 7 dots at most
  const getVisibleDotIndices = () => {
    if (userMessageCount <= MAX_VISIBLE_DOTS) {
      // Show all if less than max
      return Array.from({ length: userMessageCount }, (_, i) => i);
    }

    const halfWindow = Math.floor(MAX_VISIBLE_DOTS / 2);
    let start = currentUserMessageIndex - halfWindow;
    let end = currentUserMessageIndex + halfWindow;

    // Adjust if at the beginning
    if (start < 0) {
      end += Math.abs(start);
      start = 0;
    }

    // Adjust if at the end
    if (end >= userMessageCount) {
      start -= (end - userMessageCount + 1);
      end = userMessageCount - 1;
    }

    // Ensure start is not negative after adjustment
    start = Math.max(0, start);

    const indices = [];
    for (let i = start; i <= end; i++) {
      indices.push(i);
    }
    return indices;
  };

  const visibleDotIndices = getVisibleDotIndices();

  return (
    <div className="conversation-container" style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#fff',
    }}>
      <div className="message-header" style={{
        padding: '1.25rem 2rem',
        borderBottom: '1px solid #e8e8e8',
        backgroundColor: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        {/* Mobile menu button - only shown on mobile */}
        <button
          onClick={() => {
            if ((window as any).__toggleMobileMenu) {
              (window as any).__toggleMobileMenu();
            }
          }}
          aria-label="打开菜单"
          className="mobile-menu-button-header"
          style={{
            width: '40px',
            height: '40px',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'none', // Hidden by default, shown on mobile via CSS
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#333',
            borderRadius: '2px',
          }} />
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#333',
            borderRadius: '2px',
          }} />
          <span style={{
            width: '20px',
            height: '2px',
            backgroundColor: '#333',
            borderRadius: '2px',
          }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#333' }}>
            {projectName}
          </h2>
          <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.375rem' }}>
            {new Date(session.updatedAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
      </div>

      {/* Left side navigation dots */}
      <div
        className="nav-dots"
        style={{
          position: 'absolute',
          left: '1.5rem',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          alignItems: 'center',
          zIndex: 100,
          padding: '1rem 0',
        }}
      >
        {/* Show indicator if there are more dots above */}
        {visibleDotIndices[0] > 0 && (
          <div style={{
            fontSize: '0.75rem',
            color: '#999',
            marginBottom: '0.25rem',
          }}>
            ⋮
          </div>
        )}

        {visibleDotIndices.map((userIdx) => {
          const msgIdx = userMessageIndices[userIdx];
          const isActive = userIdx === currentUserMessageIndex;
          const message = session.messages[msgIdx];

          return (
            <button
              key={userIdx}
              onClick={() => {
                console.log(`Clicking dot ${userIdx}, message index: ${msgIdx}, role: ${message.role}, content: ${message.content.substring(0, 50)}`);
                setCurrentUserMessageIndex(userIdx);
                scrollToMessage(msgIdx);
              }}
              style={{
                width: isActive ? '12px' : '8px',
                height: isActive ? '12px' : '8px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: isActive ? '#1976d2' : '#ccc',
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 0 8px rgba(25, 118, 210, 0.5)' : 'none',
                flexShrink: 0,
              }}
              title={`Message ${userIdx + 1} of ${userMessageCount}: ${message.content.substring(0, 30)}...`}
            />
          );
        })}

        {/* Show indicator if there are more dots below */}
        {visibleDotIndices[visibleDotIndices.length - 1] < userMessageCount - 1 && (
          <div style={{
            fontSize: '0.75rem',
            color: '#999',
            marginTop: '0.25rem',
          }}>
            ⋮
          </div>
        )}
      </div>

      {/* Right side navigation controls */}
      <div className="nav-controls" style={{
        position: 'absolute',
        right: '1.5rem',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        zIndex: 100,
      }}>
        <button
          onClick={goToTop}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '1px solid #ddd',
            backgroundColor: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
          title="Go to conversation start"
        >
          ⇈
        </button>
        <button
          onClick={goToPrevious}
          disabled={currentUserMessageIndex === 0}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '1px solid #ddd',
            backgroundColor: '#fff',
            cursor: currentUserMessageIndex === 0 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            opacity: currentUserMessageIndex === 0 ? 0.5 : 1,
          }}
          title="Previous user message"
        >
          ↑
        </button>
        <button
          onClick={goToNext}
          disabled={currentUserMessageIndex >= userMessageCount - 1}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '1px solid #ddd',
            backgroundColor: '#fff',
            cursor: currentUserMessageIndex >= userMessageCount - 1 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            opacity: currentUserMessageIndex >= userMessageCount - 1 ? 0.5 : 1,
          }}
          title="Next user message"
        >
          ↓
        </button>
        <button
          onClick={goToBottom}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: '1px solid #ddd',
            backgroundColor: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
          title="Go to conversation end"
        >
          ⇊
        </button>
      </div>

      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '1.5rem 0',
        paddingLeft: '4rem',
        paddingRight: '6rem',
        backgroundColor: 'transparent',
      }}>
        {session.messages.map((message, index) => {
          const isUser = message.role === 'user' && (!message.type || message.type === 'text');

          return (
            <div
              key={index}
              ref={(el) => { messageRefs[index] = el; }}
              id={`message-${index}`}
              style={{
                maxWidth: '1200px',
                margin: '0 auto',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: isUser ? 'flex-end' : 'center',
              }}
            >
              {isCollapsible(message) ? (
                <div style={{ width: '100%', maxWidth: '900px' }}>
                  <CollapsibleMessage message={message} />
                </div>
              ) : (
                <div
                  className={`message-card ${isUser ? 'user-message' : 'assistant-message'}`}
                  style={{
                    width: isUser ? 'auto' : '100%',
                    maxWidth: isUser ? '65%' : '900px',
                    padding: '0.875rem 1.125rem',
                    borderRadius: '12px',
                    backgroundColor: isUser ? 'rgb(242, 242, 242)' : 'transparent',
                    color: '#2c2c2c',
                    boxShadow: isUser ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    position: 'relative',
                  }}
                >
                  <div style={{ color: '#333', lineHeight: '1.5' }}>
                    <MessageContent content={message.content} role={message.role} metadata={message.metadata} apiClient={apiClient} onImageClick={setLightboxSrc} />
                  </div>
                  <div style={{
                    fontSize: '0.6875rem',
                    color: '#999',
                    marginTop: '0.5rem',
                    textAlign: isUser ? 'right' : 'left',
                  }}>
                    {new Date(message.timestamp).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── 实时续聊:流式消息 ── */}
        {liveMessages && liveMessages.length > 0 && (
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            {liveMessages.map((m, i) => {
              const hasContent = m.blocks.length > 0 || m.streaming;
              if (!hasContent) return null;
              return (
                <div
                  key={`live-${i}`}
                  className="message-card assistant-message"
                  style={{ width: '100%', maxWidth: '900px', margin: '0 auto 1rem', padding: '0.5rem 0' }}
                >
                  {m.blocks.map((b, bi) => {
                    if (b.kind === 'text') {
                      const html = marked.parse(b.text, { async: false }) as string;
                      return (
                        <div
                          key={bi}
                          className="markdown-content"
                          style={{ lineHeight: '1.6' }}
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      );
                    }
                    if (b.kind === 'thinking') {
                      return <LiveCollapsible key={bi} summary="💭 思考" body={b.text} />;
                    }
                    if (b.kind === 'tool_use') {
                      return (
                        <LiveCollapsible
                          key={bi}
                          summary={`🔧 ${b.name}: ${summarizeInput(b.input)}`}
                          body={JSON.stringify(b.input, null, 2)}
                        />
                      );
                    }
                    // tool_result
                    return (
                      <LiveCollapsible
                        key={bi}
                        summary={b.isError ? '工具结果 ✗' : '工具结果 ✓'}
                        body={b.text}
                      />
                    );
                  })}
                  {m.streaming && (
                    <div className="msg-streaming" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                      {m.streaming}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 待答事项卡片 ── */}
        {pending && onAnswer && (
          <div className="pending-card" style={{ maxWidth: '900px', margin: '0 auto' }}>
            {pending.kind === 'question' && <QuestionCard prompt={pending} onAnswer={onAnswer} />}
            {pending.kind === 'permission' && <PermissionCard prompt={pending} onAnswer={onAnswer} />}
            {pending.kind === 'plan' && <PlanCard prompt={pending} onAnswer={onAnswer} />}
          </div>
        )}
      </div>
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '2rem',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightboxSrc}
            alt="Full size"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '4px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              cursor: 'default',
            }}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            aria-label="关闭"
            style={{
              position: 'absolute',
              top: '1rem',
              right: '1rem',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'rgba(255,255,255,0.9)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
