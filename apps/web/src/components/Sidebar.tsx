import { useState, useEffect } from 'react';
import type { ActiveAgent, Project, Session } from '@coderelay/shared';
import type { ApiClient } from '../api';

interface SidebarProps {
  apiClient: ApiClient;
  onSessionSelect: (projectId: string, sessionId: string) => void;
  selectedSessionId?: string;
  onNewSession?: () => void;
  /** 项目列表加载完成后上报给父组件(供顶栏展示正确的项目名) */
  onProjectsLoad?: (projects: Project[]) => void;
  activeAgents: ActiveAgent[];
  maxAgents: number;
  currentRunId?: string | null;
  currentRunConnected?: boolean;
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
  currentRunId,
  currentRunConnected = false,
  onActiveAgentSelect = () => {},
  onActiveAgentClose = () => {},
  onQuickNewSession,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, Session[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const handleNewClick = () => onNewSession?.();

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

  const statusLabel = (agent: ActiveAgent) => {
    if (agent.runId === currentRunId) {
      return currentRunConnected ? '已接管' : '接管中';
    }
    const { status } = agent;
    if (status === 'executing') return '执行中';
    if (status === 'waiting') return '等待你回答';
    return '空闲';
  };

  const activeRunForSession = (projectId: string, sessionId: string) =>
    activeAgents.find(
      (agent) =>
        agent.kind === 'continue' &&
        agent.projectId === projectId &&
        agent.sessionId === sessionId
    );

  const projectNameFor = (projectId?: string) =>
    projects.find((project) => project.id === projectId)?.name ?? projectId ?? '未知项目';

  const activeAgentTitle = (agent: ActiveAgent) => {
    if (agent.kind === 'continue') return projectNameFor(agent.projectId);
    if (agent.cwd) {
      const normalized = agent.cwd.replace(/\\/g, '/');
      return normalized.split('/').filter(Boolean).pop() ?? agent.cwd;
    }
    return '新建会话';
  };

  const activeAgentMeta = (agent: ActiveAgent) => {
    if (agent.kind === 'continue') return agent.sessionId ?? agent.runId;
    return agent.cwd ?? agent.runId;
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
      </div>

      <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
          后台运行中 {activeAgents.length}/{maxAgents}
        </div>
        {activeAgents.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#999' }}>暂无后台运行</div>
        ) : (
          activeAgents.map((agent) => {
            const title = activeAgentTitle(agent);
            const meta = activeAgentMeta(agent);
            const label = statusLabel(agent);
            const statusColor =
              label === '执行中' ? '#9a6700' :
              label === '等待你回答' ? '#0969da' :
              label === '已接管' ? '#1f883d' :
              label === '接管中' ? '#8250df' :
              '#57606a';
            return (
            <div key={agent.runId} style={{
              position: 'relative',
              marginBottom: '0.625rem',
              border: '1px solid #d8dee4',
              borderRadius: 8,
              background: '#fff',
              overflow: 'hidden',
            }}>
              <button
                aria-label={`接管后台运行 ${title}`}
                onClick={() => onActiveAgentSelect(agent)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.7rem 2.3rem 0.7rem 0.8rem',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 650, color: '#24292f' }}>
                    {title}
                  </span>
                  <span style={{
                    fontSize: '0.68rem',
                    padding: '0.08rem 0.38rem',
                    borderRadius: 999,
                    color: statusColor,
                    backgroundColor: `${statusColor}14`,
                    border: `1px solid ${statusColor}33`,
                    whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.72rem',
                  color: '#6e7781',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {meta}
                </div>
              </button>
              <button
                aria-label={`关闭后台运行 ${title}`}
                onClick={() => onActiveAgentClose(agent)}
                style={{
                  position: 'absolute',
                  top: '0.55rem',
                  right: '0.55rem',
                  width: 26,
                  height: 26,
                  border: '1px solid #d8dee4',
                  background: '#fff',
                  color: '#57606a',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  lineHeight: 1,
                }}
                title="关闭后台运行"
              >
                ×
              </button>
            </div>
          );
          })
        )}
        {isLimited && (
          <div style={{ fontSize: '0.8rem', color: '#cf222e' }}>
            已达后台运行上限，请先关闭一个
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
                aria-label={`在 ${project.name} 快速新建会话`}
                title={`在 ${project.name} 快速新建会话`}
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickNewSession?.(project.path);
                }}
                disabled={isLimited}
                style={{
                  marginLeft: 'auto',
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: '1px solid #d0d7de',
                  background: isLimited ? '#eaeef2' : '#f6f8fa',
                  color: isLimited ? '#6a737d' : '#0969da',
                  cursor: isLimited ? 'not-allowed' : 'pointer',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                +
              </button>
            </div>

            {expandedProjects.has(project.id) && sessionsByProject[project.id] && (
              <div style={{ backgroundColor: '#fafafa' }}>
                {sessionsByProject[project.id].map(session => {
                  const activeRun = activeRunForSession(project.id, session.id);
                  return (
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
                      {activeRun && (
                        <span style={{
                          marginLeft: '0.5rem',
                          color: '#0969da',
                          fontWeight: 600,
                        }}>
                          后台运行
                        </span>
                      )}
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
                );
              })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
