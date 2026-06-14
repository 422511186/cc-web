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
      // Don't auto-expand any projects
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
      backgroundColor: '#fff',
      borderRight: '1px solid #e8e8e8',
    }}>
      <div style={{
        padding: '1.25rem',
        borderBottom: '1px solid #e8e8e8',
        backgroundColor: '#fff',
      }}>
        <input
          type="text"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '0.625rem 0.875rem',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            marginBottom: '0.75rem',
            fontSize: '0.875rem',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => e.target.style.borderColor = '#1976d2'}
          onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
        />
        <button
          style={{
            width: '100%',
            padding: '0.625rem',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1565c0'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1976d2'}
        >
          + 新建会话
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {projects.map(project => (
          <div key={project.id}>
            <div
              onClick={() => toggleProject(project.id)}
              style={{
                padding: '0.875rem 1.25rem',
                cursor: 'pointer',
                backgroundColor: 'transparent',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                alignItems: 'center',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span style={{
                marginRight: '0.625rem',
                fontSize: '0.75rem',
                color: '#666',
                transition: 'transform 0.2s',
                display: 'inline-block',
                transform: expandedProjects.has(project.id) ? 'rotate(90deg)' : 'none',
              }}>
                ▸
              </span>
              <span style={{
                fontWeight: 500,
                fontSize: '0.9375rem',
                color: '#333',
              }}>
                {project.name}
              </span>
            </div>

            {expandedProjects.has(project.id) && sessionsByProject[project.id] && (
              <div style={{ backgroundColor: '#fafafa' }}>
                {sessionsByProject[project.id].map(session => (
                  <div
                    key={session.id}
                    onClick={() => onSessionSelect(project.id, session.id)}
                    style={{
                      padding: '0.75rem 1.25rem 0.75rem 2.75rem',
                      cursor: 'pointer',
                      backgroundColor: selectedSessionId === session.id ? '#e3f2fd' : 'transparent',
                      borderLeft: selectedSessionId === session.id ? '3px solid #1976d2' : '3px solid transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (selectedSessionId !== session.id) {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedSessionId !== session.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    <div style={{
                      fontSize: '0.875rem',
                      marginBottom: '0.375rem',
                      color: '#333',
                      fontWeight: selectedSessionId === session.id ? 500 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#999' }}>
                      {new Date(session.updatedAt).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
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
