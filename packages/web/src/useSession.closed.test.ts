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

  test('收到 closed 事件后暴露 closed=true 与 closedReason', () => {
    const { result } = renderHook(() => useSession('run-123'));

    expect(result.current.closed).toBe(false);
    expect(result.current.closedReason).toBe(null);

    act(() => {
      const es = vi.mocked(global.EventSource).mock.results[0].value;
      es.onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'detached' }) } as MessageEvent);
    });

    expect(result.current.closed).toBe(true);
    expect(result.current.closedReason).toBe('detached');
  });

  test('重连(onopen)后 closed 复位为 false', () => {
    const { result } = renderHook(() => useSession('run-123'));

    act(() => {
      const es = vi.mocked(global.EventSource).mock.results[0].value;
      es.onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'detached' }) } as MessageEvent);
    });
    expect(result.current.closed).toBe(true);

    // 模拟(重)连接成功:整段重放前先复位
    act(() => {
      const es = vi.mocked(global.EventSource).mock.results[0].value;
      es.onopen?.({} as Event);
    });

    expect(result.current.closed).toBe(false);
    expect(result.current.closedReason).toBe(null);
  });
});
