import { vi, beforeEach, afterEach } from 'vitest';
import { closeSession, startNew } from './chatApi';

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
