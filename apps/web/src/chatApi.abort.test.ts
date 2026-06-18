import { describe, test, expect, beforeEach, vi } from 'vitest';
import { abortSession, probeRun } from './chatApi';

describe('chatApi - abort', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    sessionStorage.setItem('authToken', 'test-token');
  });

  test('abortSession 发送 POST 到 /api/sessions/:runId/abort', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await abortSession('run-123');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/run-123/abort',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  test('abortSession 请求失败时抛出错误', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(abortSession('run-123')).rejects.toThrow('abortSession failed: 404');
  });

  test('probeRun 命中 404 时返回 false', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    await expect(probeRun('run-dead')).resolves.toBe(false);
  });

  test('probeRun 命中活跃 run 时返回 true', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ runId: 'run-123', active: true }),
    } as Response);

    await expect(probeRun('run-123')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/run-123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });
});
