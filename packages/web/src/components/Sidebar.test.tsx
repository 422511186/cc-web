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

  test('点击侧栏"新建会话"按钮时弹出目录输入框并调用 onNewSession 回调', async () => {
    vi.mocked(window.prompt).mockReturnValue('C:/my/project');
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
    await screen.findByRole('button', { name: /新建会话/ });

    const newButton = screen.getByRole('button', { name: /新建会话/ });
    fireEvent.click(newButton);

    await waitFor(() => expect(window.prompt).toHaveBeenCalledWith(
      expect.stringContaining('目录'),
      expect.any(String)
    ));

    expect(onNewSession).toHaveBeenCalledWith('C:/my/project');
  });

  test('侧栏新建按钮取消输入时不调用回调', async () => {
    vi.mocked(window.prompt).mockReturnValue(null);
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
    await screen.findByRole('button', { name: /新建会话/ });

    const newButton = screen.getByRole('button', { name: /新建会话/ });
    fireEvent.click(newButton);

    await waitFor(() => expect(window.prompt).toHaveBeenCalled());
    expect(onNewSession).not.toHaveBeenCalled();
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
