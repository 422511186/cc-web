import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';
import { Conversation } from './Conversation';
import type { ApiClient } from '../api';

function makeSession(messages: unknown[]) {
  return {
    session: {
      id: 's1',
      projectId: 'p1',
      title: 't',
      updatedAt: new Date().toISOString(),
      messages,
    },
  };
}

let sseCallback: ((u: { projectId: string; sessionId: string }) => void) | null;

function makeApiClient(getSession: ReturnType<typeof vi.fn>): ApiClient {
  sseCallback = null;
  return {
    getSession,
    connectSSE: (cb: (u: { projectId: string; sessionId: string }) => void) => {
      sseCallback = cb;
      return () => {};
    },
    imageUrl: (p: string) => p,
  } as unknown as ApiClient;
}

beforeEach(() => {
  sseCallback = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Conversation 项目名展示', () => {
  test('传入 projectName 时应展示真实项目名(不自动从 projectId 推导)', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValue(makeSession([{ role: 'user', content: '测试', timestamp: Date.now() }]));

    const apiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={apiClient}
        projectId="C--Users-huang-workspace-cc-web-develop"
        sessionId="s1"
        projectName="cc-web-develop"
      />
    );

    await waitFor(() => screen.getByText('cc-web-develop'));
    expect(screen.queryByText('develop')).toBeNull();
  });
});

describe('Conversation 续聊活跃时不被文件刷新重复合并', () => {
  test('liveMessages 有值时,session-update 不再重新拉取并合并历史', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(makeSession([{ role: 'user', content: '问题', timestamp: Date.now() }]))
      // 第二次(文件变更后)若被调用会带上 assistant 回复 → 造成与实时流重复
      .mockResolvedValue(
        makeSession([
          { role: 'user', content: '问题', timestamp: Date.now() },
          { role: 'assistant', content: '回答', timestamp: Date.now() },
        ])
      );

    const apiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={apiClient}
        projectId="p1"
        sessionId="s1"
        liveMessages={[]}
      />
    );

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    const callsBefore = getSession.mock.calls.length;
    // 模拟文件变更推送
    sseCallback?.({ projectId: 'p1', sessionId: 's1' });

    // 续聊活跃:不应为合并历史而再次拉取 session
    await new Promise((r) => setTimeout(r, 50));
    expect(getSession).toHaveBeenCalledTimes(callsBefore);
  });
});

describe('Conversation 历史/实时边界去重', () => {
  test('historyBoundary 限定历史渲染条数,越界部分(本轮已落盘)交给实时流,不重复', async () => {
    // 切回时 JSONL 已含本轮落盘的"问题/回答",共 3 条;但起跑那刻只有 1 条历史。
    const getSession = vi.fn().mockResolvedValue(
      makeSession([
        { role: 'user', content: '历史问题', timestamp: Date.now() },
        { role: 'user', content: '本轮问题', timestamp: Date.now() },
        { role: 'assistant', content: '本轮已落盘回答', timestamp: Date.now() },
      ])
    );
    const apiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={apiClient}
        projectId="p1"
        sessionId="s1"
        historyBoundary={1}
        liveMessages={[
          { role: 'user', blocks: [{ kind: 'text', text: '本轮问题' }], streaming: '' },
          { role: 'assistant', blocks: [{ kind: 'text', text: '本轮已落盘回答' }], streaming: '' },
        ]}
      />
    );

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    // 边界内的历史正常渲染
    await screen.findByText('历史问题');
    // 越界历史(本轮已落盘)不应作为历史再渲染一遍 → 仅出现 1 次(由实时流提供)
    await waitFor(() => {
      expect(screen.getAllByText('本轮已落盘回答')).toHaveLength(1);
    });
  });
});

describe('Conversation 编辑工具显示行级 diff', () => {
  test('历史 Edit tool_use 展开后用 DiffView 显示增删行,而非原始 JSON', async () => {
    const getSession = vi.fn().mockResolvedValue(
      makeSession([
        {
          role: 'assistant',
          content: '',
          type: 'tool_use',
          timestamp: Date.now(),
          metadata: {
            toolName: 'Edit',
            toolInput: {
              file_path: '/proj/a.ts',
              old_string: 'const x = 1',
              new_string: 'const x = 2',
            },
          },
        },
      ])
    );
    const apiClient = makeApiClient(getSession);

    render(<Conversation apiClient={apiClient} projectId="p1" sessionId="s1" />);

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    // 展开折叠的工具卡片(摘要显示工具名 Edit)
    const summary = await screen.findAllByText('Edit');
    fireEvent.click(summary[0]);

    // DiffView:删除旧行、新增新行,且显示 file_path
    expect(await screen.findByText('- const x = 1')).toHaveClass('diff-del');
    expect(screen.getByText('+ const x = 2')).toHaveClass('diff-add');
    expect(screen.getByText('/proj/a.ts')).toBeInTheDocument();
  });

  test('实时流 tool_use(MultiEdit)用 DiffView 显示多段增删行', async () => {
    const getSession = vi.fn().mockResolvedValue(makeSession([]));
    const apiClient = makeApiClient(getSession);

    render(
      <Conversation
        apiClient={apiClient}
        projectId="p1"
        sessionId="s1"
        liveMessages={[
          {
            role: 'assistant',
            blocks: [
              {
                kind: 'tool_use',
                name: 'MultiEdit',
                toolUseId: 't1',
                input: {
                  file_path: '/proj/b.ts',
                  edits: [
                    { old_string: 'foo', new_string: 'bar' },
                    { old_string: 'baz', new_string: 'qux' },
                  ],
                },
              },
            ],
            streaming: '',
          },
        ]}
      />
    );

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));

    // 实时流里编辑工具默认展开,直接显示 diff
    expect(await screen.findByText('- foo')).toHaveClass('diff-del');
    expect(screen.getByText('+ bar')).toHaveClass('diff-add');
    expect(screen.getByText('- baz')).toHaveClass('diff-del');
    expect(screen.getByText('+ qux')).toHaveClass('diff-add');
    expect(screen.getByText('/proj/b.ts')).toBeInTheDocument();
  });
});
