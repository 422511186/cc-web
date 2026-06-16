import { renderHook, act } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';
import { useSession } from './useSession';
import type { ServerEvent } from '@cc-web/shared';

// 受控的 EventSource mock:能手动触发 open / message
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = 2;
  }
  emit(event: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource as unknown;
  Storage.prototype.getItem = vi.fn(() => 'test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSession 服务端回显与重连重建', () => {
  test('user_message 事件在实时流里追加一条 user 消息', () => {
    const { result } = renderHook(() => useSession('run-1'));

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'user_message', text: '你好' } as ServerEvent);
    });

    const userMsgs = result.current.messages.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].blocks).toEqual([{ kind: 'text', text: '你好' }]);
  });

  test('用户消息之后到达的 assistant delta 进入新的 assistant 气泡,不混入 user 消息', () => {
    const { result } = renderHook(() => useSession('run-1'));

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'user_message', text: '问题' } as ServerEvent);
    });
    act(() => {
      FakeEventSource.instances[0].emit({ type: 'delta', text: '回答' } as ServerEvent);
    });

    const userMsg = result.current.messages.find((m) => m.role === 'user');
    expect(userMsg?.blocks).toEqual([{ kind: 'text', text: '问题' }]);
    const assistantMsg = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.streaming).toBe('回答');
  });

  test('重连(再次连接)先重置消息,再吃整段重放从零重建', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession('run-1'));

      // 第一次连接:收到一段流
      act(() => {
        FakeEventSource.instances[0].onopen?.();
        FakeEventSource.instances[0].emit({ type: 'user_message', text: '问题' } as ServerEvent);
        FakeEventSource.instances[0].emit({ type: 'delta', text: '答' } as ServerEvent);
      });
      expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);

      // 模拟断开:onerror 触发 close + 2s 后重连
      act(() => {
        FakeEventSource.instances[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      // 第二次连接 onopen 应重置,随后服务端整段重放(含同一条 user_message)
      act(() => {
        const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
        es.onopen?.();
        es.emit({ type: 'user_message', text: '问题' } as ServerEvent);
        es.emit({ type: 'delta', text: '答' } as ServerEvent);
      });

      // 不应因重放而重复:仍只有一条 user 消息
      expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useSession 执行状态与模型信息', () => {
  test('status 事件更新 status 字段(idle/executing/waiting)', () => {
    const { result } = renderHook(() => useSession('run-1'));
    // 默认空闲
    expect(result.current.status).toBe('idle');

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'status', state: 'executing' } as ServerEvent);
    });
    expect(result.current.status).toBe('executing');

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'status', state: 'waiting' } as ServerEvent);
    });
    expect(result.current.status).toBe('waiting');

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'status', state: 'idle' } as ServerEvent);
    });
    expect(result.current.status).toBe('idle');
  });

  test('run_info 事件记录 model(effort 缺失)', () => {
    const { result } = renderHook(() => useSession('run-1'));
    expect(result.current.model).toBeNull();

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'run_info', model: 'claude-opus-4-8' } as ServerEvent);
    });
    expect(result.current.model).toBe('claude-opus-4-8');
    expect(result.current.effort).toBeNull();
  });

  test('重连(整段重放)后 status/model 以最后一次为准', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession('run-1'));

      act(() => {
        FakeEventSource.instances[0].onopen?.();
        FakeEventSource.instances[0].emit({ type: 'status', state: 'executing' } as ServerEvent);
        FakeEventSource.instances[0].emit({ type: 'run_info', model: 'claude-opus-4-8' } as ServerEvent);
      });
      expect(result.current.status).toBe('executing');

      // 断开并重连
      act(() => {
        FakeEventSource.instances[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      // 重连 onopen 重置后整段重放:这次只重放到 idle
      act(() => {
        const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
        es.onopen?.();
        es.emit({ type: 'run_info', model: 'claude-opus-4-8' } as ServerEvent);
        es.emit({ type: 'status', state: 'idle' } as ServerEvent);
      });
      expect(result.current.status).toBe('idle');
      expect(result.current.model).toBe('claude-opus-4-8');
    } finally {
      vi.useRealTimers();
    }
  });
});
