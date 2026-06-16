import { vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './api';

describe('ApiClient.deleteSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('应以带鉴权头的 DELETE 请求删除指定会话', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient('test-token-123');
    const result = await client.deleteSession('proj 1', 'sess/1');

    expect(result).toEqual({ ok: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/projects/proj%201/sessions/sess%2F1');
    expect(options.method).toBe('DELETE');
    const headers = new Headers(options.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token-123');
  });

  test('请求失败时抛出错误', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Session not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createApiClient('t');
    await expect(client.deleteSession('p', 's')).rejects.toThrow('Session not found');
  });
});
