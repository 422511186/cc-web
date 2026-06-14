import { useState, useEffect } from 'react';
import type { SessionDetail } from '@cc-web/shared';
import type { ApiClient } from '../api';

interface ConversationProps {
  apiClient: ApiClient;
  projectId: string;
  sessionId: string;
}

export function Conversation({ apiClient, projectId, sessionId }: ConversationProps) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSession();
  }, [projectId, sessionId]);

  const loadSession = async () => {
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

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '1rem',
        borderBottom: '1px solid #ddd',
        backgroundColor: '#fff',
      }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{session.title}</h2>
        <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
          Last updated: {new Date(session.updatedAt).toLocaleString()}
        </div>
      </div>

      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '1rem',
        backgroundColor: '#f5f5f5',
      }}>
        {session.messages.map((message, index) => (
          <div
            key={index}
            style={{
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '70%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: message.role === 'user' ? '#1976d2' : '#fff',
                color: message.role === 'user' ? '#fff' : '#000',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{
                fontSize: '0.75rem',
                opacity: 0.8,
                marginBottom: '0.25rem',
                fontWeight: 500,
              }}>
                {message.role === 'user' ? 'You' : 'Assistant'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {message.content}
              </div>
              {message.model && (
                <div style={{
                  fontSize: '0.625rem',
                  opacity: 0.6,
                  marginTop: '0.25rem',
                }}>
                  {message.model}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
