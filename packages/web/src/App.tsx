import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { MobileMenu } from './components/MobileMenu';
import { createApiClient } from './api';
import type { ApiClient } from './api';

function App() {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [selectedSession, setSelectedSession] = useState<{
    projectId: string;
    sessionId: string;
  } | null>(null);

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
    // Update URL with session info
    const params = new URLSearchParams();
    params.set('project', projectId);
    params.set('session', sessionId);
    window.history.pushState({}, '', `?${params.toString()}`);
  };

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

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedSession ? (
          <Conversation
            apiClient={apiClient!}
            projectId={selectedSession.projectId}
            sessionId={selectedSession.sessionId}
          />
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
            }}>
              从左侧选择一个会话开始查看
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
