import { vi, beforeEach, afterEach } from 'vitest';
import { closeSession, startNew, listActiveAgents, closeAgent, heartbeatSession, respond } from './chatApi';

beforeEach(() => {
  Storage.prototype.getItem = vi.fn(() => 'tok');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('closeSession', () => {
  test('对指定 runId 发 DELETE,并带鉴权头与 keepalive', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await closeSession('run-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/run-1');
    expect(init.method).toBe('DELETE');
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  test('请求失败时静默吞掉(关闭是尽力而为,不应抛错打断切换)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(closeSession('run-2')).resolves.toBeUndefined();
  });
});

describe('startNew', () => {
  test('不传 cwd 时请求体为空对象', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'new-run-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const runId = await startNew();

    expect(runId).toBe('new-run-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/new');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  test('传入 cwd 时请求体包含 cwd 字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runId: 'new-run-2' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const runId = await startNew('C:/my/project');

    expect(runId).toBe('new-run-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/new');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ cwd: 'C:/my/project' });
  });
});

describe('active agents', () => {
  test('listActiveAgents returns active list with auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [], maxConcurrent: 3 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listActiveAgents();

    expect(result.maxConcurrent).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/active', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    }));
  });

  test('closeAgent sends POST to close endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await closeAgent('run-9');

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/run-9/close', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    }));
  });

  test('heartbeatSession sends POST and returns lease response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        runId: 'run-9',
        status: 'idle',
        attached: true,
        leaseExpiresAt: 123,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await heartbeatSession('run-9');

    expect(result).toMatchObject({
      ok: true,
      runId: 'run-9',
      status: 'idle',
      attached: true,
      leaseExpiresAt: 123,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/run-9/heartbeat', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    }));
  });
});

describe('respond', () => {
  test('后端返回 ok:false 时抛出错误，避免前端把失效待答项当成已处理', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      respond('run-1', { kind: 'permission', id: 'perm-1', decision: 'allow' })
    ).rejects.toThrow(/pending/i);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/run-1/respond',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });
});
