import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';
import { Sidebar } from './Sidebar';
import type { ApiClient } from '../api';

function makeApiClient(overrides: Partial<Record<string, unknown>> = {}): ApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: 'proj1', name: 'proj1', path: 'C:/proj1' }],
    }),
    listSessions: vi.fn().mockResolvedValue({
      sessions: [
        {
          id: 'sess1',
          projectId: 'proj1',
          title: '第一个会话',
          createdAt: 1000,
          updatedAt: 2000,
          messageCount: 3,
        },
      ],
    }),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as ApiClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sidebar 删除历史会话', () => {
  test('点击删除按钮并确认后调用 api.deleteSession 且该行从列表移除', async () => {
    const apiClient = makeApiClient();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <Sidebar apiClient={apiClient} onSessionSelect={() => {}} />
    );

    // 等待项目自动展开并加载会话
    await screen.findByText('第一个会话');

    // 点击该会话的删除按钮
    const deleteBtn = screen.getByRole('button', { name: '删除会话' });
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(apiClient.deleteSession).toHaveBeenCalledWith('proj1', 'sess1')
    );

    // 该行应从列表移除
    await waitFor(() =>
      expect(screen.queryByText('第一个会话')).not.toBeInTheDocument()
    );
  });

  test('取消确认时不调用 api.deleteSession 且该行保留', async () => {
    const apiClient = makeApiClient();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <Sidebar apiClient={apiClient} onSessionSelect={() => {}} />
    );

    // 等待项目自动展开并加载会话
    await screen.findByText('第一个会话');

    fireEvent.click(screen.getByRole('button', { name: '删除会话' }));

    expect(apiClient.deleteSession).not.toHaveBeenCalled();
    expect(screen.getByText('第一个会话')).toBeInTheDocument();
  });
});

describe('Sidebar 新建会话按钮', () => {
  beforeEach(() => {
    global.window.prompt = vi.fn();
  });

  test('点击侧栏"新建会话"按钮只打开新建流程,不直接使用第一个项目路径', async () => {
    const onNewSession = vi.fn();
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        onNewSession={onNewSession}
      />
    );

    // 等待加载完成
    await screen.findByRole('button', { name: '+ 新建会话' });

    const newButton = screen.getByRole('button', { name: '+ 新建会话' });
    fireEvent.click(newButton);

    expect(window.prompt).not.toHaveBeenCalled();
    expect(onNewSession).toHaveBeenCalledWith();
  });

  test('顶部不再显示“快速新建当前项目”按钮,避免和新建会话入口混淆', async () => {
    const onNewSession = vi.fn();
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        onNewSession={onNewSession}
      />
    );

    // 等待加载完成
    await screen.findByRole('button', { name: '+ 新建会话' });

    expect(screen.queryByRole('button', { name: /快速新建当前项目/ })).not.toBeInTheDocument();
  });
});

describe('Sidebar 自动展开', () => {
  test('加载项目后自动展开第一个项目', async () => {
    const projects = [
      { id: 'p1', name: 'Project 1' },
      { id: 'p2', name: 'Project 2' },
    ];
    const sessions = [
      {
        id: 's1',
        projectId: 'p1',
        title: 'Session 1',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
      },
    ];

    const apiClient = makeApiClient({
      listProjects: vi.fn().mockResolvedValue({ projects }),
      listSessions: vi.fn().mockResolvedValue({ sessions }),
    });

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
      />
    );

    // 等待项目加载
    await waitFor(() => expect(apiClient.listProjects).toHaveBeenCalled());

    // 应该自动加载第一个项目的会话列表
    await waitFor(() => expect(apiClient.listSessions).toHaveBeenCalledWith('p1'));

    // 应该显示第一个项目的会话
    expect(await screen.findByText('Session 1')).toBeInTheDocument();
  });
});

describe('Sidebar 后台运行与快速新建', () => {
  test('项目标题上的快速新建按钮直接使用该项目 path', async () => {
    const apiClient = makeApiClient();
    const onQuickNewSession = vi.fn();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        onQuickNewSession={onQuickNewSession}
        activeAgents={[]}
        maxAgents={3}
        onActiveAgentSelect={() => {}}
        onActiveAgentClose={() => {}}
      />
    );

    await screen.findByText('第一个会话');
    fireEvent.click(screen.getByRole('button', { name: '在 proj1 快速新建会话' }));

    expect(onQuickNewSession).toHaveBeenCalledWith('C:/proj1');
  });

  test('后台运行卡片展示项目身份、状态并允许接管和关闭', async () => {
    const apiClient = makeApiClient();
    const onActiveAgentSelect = vi.fn();
    const onActiveAgentClose = vi.fn();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        activeAgents={[
          {
            runId: 'run-1',
            kind: 'continue',
            sessionId: 'sess1',
            projectId: 'proj1',
            status: 'executing',
            createdAt: 1,
            lastEventAt: 1,
          },
        ]}
        maxAgents={3}
        onActiveAgentSelect={onActiveAgentSelect}
        onActiveAgentClose={onActiveAgentClose}
      />
    );

    await screen.findByText(/后台运行中 1\/3/);
    expect(screen.getByRole('button', { name: /接管后台运行 proj1/ })).toBeInTheDocument();
    expect(screen.getByText('执行中')).toBeInTheDocument();
    expect(screen.getByText(/sess1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /接管后台运行 proj1/ }));
    expect(onActiveAgentSelect).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' })
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭后台运行 proj1' }));
    expect(onActiveAgentClose).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' })
    );
  });

  test('当前浏览器正在接管但 SSE 尚未连接时,后台运行项显示“接管中”', async () => {
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        activeAgents={[
          {
            runId: 'run-connecting',
            kind: 'continue',
            sessionId: 'sess1',
            projectId: 'proj1',
            status: 'executing',
            createdAt: 1,
            lastEventAt: 1,
          },
        ]}
        maxAgents={3}
        currentRunId="run-connecting"
        currentRunConnected={false}
        onActiveAgentSelect={() => {}}
        onActiveAgentClose={() => {}}
      />
    );

    await screen.findByText('接管中');
    expect(screen.getByRole('button', { name: /接管后台运行 proj1/ })).toBeInTheDocument();
    expect(screen.queryByText('执行中')).not.toBeInTheDocument();
  });

  test('当前浏览器已接管的后台运行项显示“已接管”', async () => {
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        activeAgents={[
          {
            runId: 'run-connected',
            kind: 'continue',
            sessionId: 'sess1',
            projectId: 'proj1',
            status: 'idle',
            createdAt: 1,
            lastEventAt: 1,
          },
        ]}
        maxAgents={3}
        currentRunId="run-connected"
        currentRunConnected={true}
        onActiveAgentSelect={() => {}}
        onActiveAgentClose={() => {}}
      />
    );

    await screen.findByText('已接管');
    expect(screen.getByRole('button', { name: /接管后台运行 proj1/ })).toBeInTheDocument();
    expect(screen.queryByText('空闲')).not.toBeInTheDocument();
  });

  test('历史会话行显示后台运行徽标', async () => {
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        activeAgents={[
          {
            runId: 'sess1',
            kind: 'continue',
            sessionId: 'sess1',
            projectId: 'proj1',
            status: 'waiting',
            createdAt: 1,
            lastEventAt: 1,
          },
        ]}
        maxAgents={3}
        onActiveAgentSelect={() => {}}
        onActiveAgentClose={() => {}}
      />
    );

    await screen.findByText('第一个会话');
    expect(screen.getByText('后台运行')).toBeInTheDocument();
  });

  test('达到上限时禁用快速新建并显示提示', async () => {
    const apiClient = makeApiClient();

    render(
      <Sidebar
        apiClient={apiClient}
        onSessionSelect={() => {}}
        activeAgents={[
          { runId: '1', kind: 'new', sessionId: null, status: 'idle', createdAt: 1, lastEventAt: 1 },
          { runId: '2', kind: 'new', sessionId: null, status: 'idle', createdAt: 1, lastEventAt: 1 },
          { runId: '3', kind: 'continue', sessionId: 's3', projectId: 'p3', status: 'waiting', createdAt: 1, lastEventAt: 1 },
        ]}
        maxAgents={3}
        onActiveAgentSelect={() => {}}
        onActiveAgentClose={() => {}}
      />
    );

    await screen.findByText(/已达后台运行上限/);
    expect(screen.getByRole('button', { name: /\+ 新建会话/ })).toBeDisabled();
  });
});
