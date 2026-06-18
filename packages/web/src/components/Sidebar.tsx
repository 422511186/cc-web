import { useState, useEffect } from 'react';
import type { ActiveAgent, Project, Session } from '@cc-web/shared';
import type { ApiClient } from '../api';

interface SidebarProps {
  apiClient: ApiClient;
  onSessionSelect: (projectId: string, sessionId: string) => void;
  selectedSessionId?: string;
  onNewSession?: (cwd: string) => void;
  /** 项目列表加载完成后上报给父组件(供顶栏展示正确的项目名) */
  onProjectsLoad?: (projects: Project[]) => void;
  activeAgents: ActiveAgent[];
  maxAgents: number;
  onActiveAgentSelect: (agent: ActiveAgent) => void;
  onActiveAgentClose: (agent: ActiveAgent) => void;
  onQuickNewSession?: (cwd: string) => void;
}

export function Sidebar({
  apiClient,
  onSessionSelect,
  selectedSessionId,
  onNewSession,
  onProjectsLoad,
  activeAgents = [],
  maxAgents = 3,
  onActiveAgentSelect = () => {},
  onActiveAgentClose = () => {},
  onQuickNewSession,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const handleNewClick = () => {
    const cwd = window.prompt('请输入工作目录路径（留空则使用默认）:', '');
    if (cwd === null) return; // 用户取消
    if (onNewSession) {
      onNewSession(cwd || '');
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await apiClient.listProjects();
      setProjects(response.projects);
      onProjectsLoad?.(response.projects);

      // 自动展开第一个项目（如果有）
      if (response.projects.length > 0) {
        const firstProject = response.projects[0];
        setExpandedProjects(new Set([firstProject.id]));
        loadSessions(firstProject.id);
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

  const handleDeleteSession = async (
    e: React.MouseEvent,
    projectId: string,
    sessionId: string,
  ) => {
    // 阻止冒泡,避免触发选中该会话
    e.stopPropagation();

    if (!window.confirm('确定删除这个会话吗?会话将从列表隐藏(文件保留在磁盘上,可手动恢复)。')) {
      return;
    }

    try {
      await apiClient.deleteSession(projectId, sessionId);
      // 从列表移除该会话
      setSessionsByProject(prev => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter(s => s.id !== sessionId),
      }));
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const isLimited = activeAgents.length >= maxAgents;

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
        <button
          onClick={handleNewClick}
          disabled={isLimited}
          style={{
            width: '100%',
            padding: '0.625rem',
            backgroundColor: isLimited ? '#eaeef2' : '#1976d2',
            color: isLimited ? '#6a737d' : 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: isLimited ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            transition: 'background-color 0.2s',
            marginBottom: '0.5rem',
          }}
        >
          + 新建会话
        </button>
        <button
          onClick={() => onQuickNewSession?.(projects[0]?.path ?? '')}
          disabled={isLimited || !projects[0]}
          style={{
            width: '100%',
            padding: '0.625rem',
            backgroundColor: isLimited || !projects[0] ? '#eaeef2' : '#fff',
            color: isLimited || !projects[0] ? '#6a737d' : '#1976d2',
            border: '1px solid #1976d2',
            borderRadius: '6px',
            cursor: isLimited || !projects[0] ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            transition: 'background-color 0.2s',
          }}
        >
          快速新建当前项目
        </button>
      </div>

      <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
          活跃 Agents {activeAgents.length}/{maxAgents}
        </div>
        {activeAgents.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#999' }}>暂无活跃 agent</div>
        ) : (
          activeAgents.map((agent) => (
            <div key={agent.runId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button
                onClick={() => onActiveAgentSelect(agent)}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '0.5rem 0.65rem',
                  borderRadius: 6,
                  border: '1px solid #d0d7de',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  {agent.kind === 'continue' ? '历史续聊' : '新建会话'} · {agent.status}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#666' }}>{agent.runId}</div>
              </button>
              <button
                aria-label={`关闭 ${agent.runId}`}
                onClick={() => onActiveAgentClose(agent)}
                style={{
                  border: '1px solid #dc3545',
                  background: '#fff',
                  color: '#dc3545',
                  borderRadius: 6,
                  padding: '0.35rem 0.5rem',
                  cursor: 'pointer',
                }}
              >
                关
              </button>
            </div>
          ))
        )}
        {isLimited && (
          <div style={{ fontSize: '0.8rem', color: '#cf222e' }}>
            已达上限，请先关闭一个 agent
          </div>
        )}
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickNewSession?.(project.path);
                }}
                disabled={isLimited}
                style={{
                  marginLeft: 'auto',
                  padding: '0.25rem 0.5rem',
                  borderRadius: 6,
                  border: '1px solid #1976d2',
                  background: isLimited ? '#eaeef2' : '#fff',
                  color: isLimited ? '#6a737d' : '#1976d2',
                  cursor: isLimited ? 'not-allowed' : 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                快速新建
              </button>
            </div>

            {expandedProjects.has(project.id) && sessionsByProject[project.id] && (
              <div style={{ backgroundColor: '#fafafa' }}>
                {sessionsByProject[project.id].map(session => (
                  <div
                    key={session.id}
                    onClick={() => onSessionSelect(project.id, session.id)}
                    style={{
                      padding: '0.75rem 2.5rem 0.75rem 2.75rem', // 右侧增加 padding 给删除按钮留空间
                      cursor: 'pointer',
                      position: 'relative',
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
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      lineHeight: '1.4',
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
                    <button
                      aria-label="删除会话"
                      title="删除会话"
                      onClick={(e) => handleDeleteSession(e, project.id, session.id)}
                      className="session-delete-btn"
                      style={{
                        position: 'absolute',
                        top: '50%',
                        right: '0.75rem',
                        transform: 'translateY(-50%)',
                        width: '20px',
                        height: '20px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#999',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        padding: 0,
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        opacity: 0.6,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#ffebee';
                        e.currentTarget.style.color = '#ef5350';
                        e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = '#999';
                        e.currentTarget.style.opacity = '0.6';
                      }}
                    >
                      ✕
                    </button>
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
