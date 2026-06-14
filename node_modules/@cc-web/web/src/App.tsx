import { useState } from 'react';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { createApiClient } from './api';
import type { ApiClient } from './api';

function App() {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [selectedSession, setSelectedSession] = useState<{
    projectId: string;
    sessionId: string;
  } | null>(null);

  const handleLogin = (token: string) => {
    const client = createApiClient(token);
    setApiClient(client);
    // Store token in sessionStorage for reload persistence
    sessionStorage.setItem('authToken', token);
  };

  const handleSessionSelect = (projectId: string, sessionId: string) => {
    setSelectedSession({ projectId, sessionId });
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
      <div style={{
        width: '300px',
        flexShrink: 0,
      }}>
        <Sidebar
          apiClient={apiClient}
          onSessionSelect={handleSessionSelect}
          selectedSessionId={selectedSession?.sessionId}
        />
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedSession ? (
          <Conversation
            apiClient={apiClient}
            projectId={selectedSession.projectId}
            sessionId={selectedSession.sessionId}
          />
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
          }}>
            Select a conversation to view
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
