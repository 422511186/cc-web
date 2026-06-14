import { useState, useEffect } from 'react';
import type { Project, Session } from '@cc-web/shared';
import type { ApiClient } from '../api';

interface SidebarProps {
  apiClient: ApiClient;
  onSessionSelect: (projectId: string, sessionId: string) => void;
  selectedSessionId?: string;
}

export function Sidebar({ apiClient, onSessionSelect, selectedSessionId }: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await apiClient.listProjects();
      setProjects(response.projects);

      // Auto-expand first project and load its sessions
      if (response.projects.length > 0) {
        const firstProjectId = response.projects[0].id;
        setExpandedProjects(new Set([firstProjectId]));
        loadSessions(firstProjectId);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async (projectId: string) => {
    try {
      const response = await apiClient.listSessions(projectId);
      setSessionsByProject(prev => ({
        ...prev,
        [projectId]: response.sessions,
      }));
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
      if (!sessionsByProject[projectId]) {
        loadSessions(projectId);
      }
    }
    setExpandedProjects(newExpanded);
  };

  if (loading) {
    return <div style={{ padding: '1rem' }}>Loading...</div>;
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#f9f9f9',
      borderRight: '1px solid #ddd',
    }}>
      <div style={{ padding: '1rem', borderBottom: '1px solid #ddd' }}>
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            marginBottom: '0.5rem',
          }}
        />
        <button
          style={{
            width: '100%',
            padding: '0.5rem',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          + New Conversation
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {projects.map(project => (
          <div key={project.id}>
            <div
              onClick={() => toggleProject(project.id)}
              style={{
                padding: '0.75rem 1rem',
                cursor: 'pointer',
                backgroundColor: expandedProjects.has(project.id) ? '#e3f2fd' : 'transparent',
                borderBottom: '1px solid #eee',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span style={{ marginRight: '0.5rem' }}>
                {expandedProjects.has(project.id) ? '▾' : '▸'}
              </span>
              <span style={{ fontWeight: 500 }}>{project.name}</span>
            </div>

            {expandedProjects.has(project.id) && sessionsByProject[project.id] && (
              <div>
                {sessionsByProject[project.id].map(session => (
                  <div
                    key={session.id}
                    onClick={() => onSessionSelect(project.id, session.id)}
                    style={{
                      padding: '0.5rem 1rem 0.5rem 2.5rem',
                      cursor: 'pointer',
                      backgroundColor: selectedSessionId === session.id ? '#bbdefb' : 'transparent',
                      borderBottom: '1px solid #f0f0f0',
                    }}
                  >
                    <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#666' }}>
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
