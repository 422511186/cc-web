import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from './useSession';

describe('useSession - closed event', () => {
  beforeEach(() => {
    sessionStorage.setItem('authToken', 'test-token');
    global.EventSource = vi.fn().mockImplementation(() => ({
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    })) as any;
  });

  test('收到 closed 事件后 status 变为 idle', () => {
    const { result } = renderHook(() => useSession('run-123'));

    // 模拟 status 事件设置为 executing
    act(() => {
      const es = vi.mocked(global.EventSource).mock.results[0].value;
      es.onmessage?.({ data: JSON.stringify({ type: 'status', state: 'executing' }) } as MessageEvent);
    });

    expect(result.current.status).toBe('executing');

    // 模拟 closed 事件
    act(() => {
      const es = vi.mocked(global.EventSource).mock.results[0].value;
      es.onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'aborted' }) } as MessageEvent);
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.connected).toBe(false);
  });
});
