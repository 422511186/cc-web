import { vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from './api';
import type { CodeRelayTransport, TransportStream } from '@coderelay/transport';

function fakeTransport(): CodeRelayTransport & {
  request: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(),
    subscribe: vi.fn(),
  };
}

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

  test('401 未授权时触发 onUnauthorized 回调并继续抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUnauthorized = vi.fn();

    const client = createApiClient('expired-token-123', onUnauthorized);

    await expect(client.deleteSession('p', 's')).rejects.toThrow('Unauthorized');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('ApiClient.connectSSE', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('disconnect 应主动关闭当前 EventSource 并清空引用', () => {
    const close = vi.fn();
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: ((error: unknown) => void) | null = null;
      addEventListener = vi.fn();
      readyState = 0;
      constructor(public url: string) {}
      close = close;
    }
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

    const client = createApiClient('test-token-123');
    client.connectSSE(() => {});

    expect(close).not.toHaveBeenCalled();

    client.disconnect();

    expect(close).toHaveBeenCalledTimes(1);
  });

  test('注入 transport 时通过 transport.subscribe 订阅浏览事件并支持关闭', () => {
    const close = vi.fn();
    const transport = fakeTransport();
    transport.subscribe.mockReturnValue({ close } satisfies TransportStream);
    const onUpdate = vi.fn();

    const client = createApiClient('test-token-123', undefined, transport);
    client.connectSSE(onUpdate);

    expect(transport.subscribe).toHaveBeenCalledWith({
      path: '/events',
      eventName: 'session-update',
      onEvent: onUpdate,
    });

    client.disconnect();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('ApiClient transport injection', () => {
  test('listProjects 通过注入的 transport 发起请求', async () => {
    const transport = fakeTransport();
    transport.request.mockResolvedValue({ projects: [] });

    const client = createApiClient('test-token-123', undefined, transport);
    const result = await client.listProjects();

    expect(result).toEqual({ projects: [] });
    expect(transport.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/projects',
    });
  });
});
