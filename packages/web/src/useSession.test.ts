import { renderHook, act } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';
import { useSession } from './useSession';
import type { ServerEvent } from '@cc-web/shared';

// 受控的 EventSource mock:能手动触发 open / message
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
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

  test('重连 onopen 到首条重放事件之间保留旧消息,避免界面闪烁清空', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession('run-1'));

      act(() => {
        FakeEventSource.instances[0].onopen?.();
        FakeEventSource.instances[0].emit({ type: 'user_message', text: '旧问题' } as ServerEvent);
        FakeEventSource.instances[0].emit({ type: 'delta', text: '旧回答' } as ServerEvent);
      });

      expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);

      act(() => {
        FakeEventSource.instances[0].onerror?.();
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      const reconnectEs = FakeEventSource.instances[FakeEventSource.instances.length - 1];
      act(() => {
        reconnectEs.onopen?.();
      });

      // 在首条重放事件到来前,旧消息仍保留,不应瞬间清空造成闪烁
      expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(
        result.current.messages.find((m) => m.role === 'assistant')?.streaming
      ).toBe('旧回答');

      act(() => {
        reconnectEs.emit({ type: 'user_message', text: '旧问题' } as ServerEvent);
        reconnectEs.emit({ type: 'delta', text: '旧回答' } as ServerEvent);
      });

      expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);
      expect(
        result.current.messages.find((m) => m.role === 'assistant')?.streaming
      ).toBe('旧回答');
    } finally {
      vi.useRealTimers();
    }
  });

  test('turn_end 不应追加空 assistant 消息,下一轮对话仍能正常分隔', () => {
    const { result } = renderHook(() => useSession('run-1'));

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'user_message', text: '第一问' } as ServerEvent);
      FakeEventSource.instances[0].emit({ type: 'delta', text: '第一答' } as ServerEvent);
      FakeEventSource.instances[0].emit({ type: 'turn_end' } as ServerEvent);
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      blocks: [{ kind: 'text', text: '第一问' }],
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: '第一答',
    });

    act(() => {
      FakeEventSource.instances[0].emit({ type: 'user_message', text: '第二问' } as ServerEvent);
      FakeEventSource.instances[0].emit({ type: 'delta', text: '第二答' } as ServerEvent);
    });

    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(result.current.messages[3]).toMatchObject({
      role: 'assistant',
      streaming: '第二答',
    });
  });
});

describe('useSession 执行状态与模型信息', () => {
  test('apply callback 应有空依赖数组防止重渲染时重新创建导致 SSE 重连', () => {
    const { result, rerender } = renderHook(() => useSession('run-1'));

    const firstES = FakeEventSource.instances[FakeEventSource.instances.length - 1];

    // 强制重渲染（模拟父组件 state 变化）
    rerender();
    rerender();
    rerender();

    // 不应创建新的 EventSource：apply 稳定，useEffect 依赖不变
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]).toBe(firstES);
  });

  test('重连使用指数退避算法，最多 5 次后停止', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession('run-1'));

      // 触发断开
      act(() => {
        FakeEventSource.instances[0].onerror?.();
      });

      // 第1次重连：1秒后
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(FakeEventSource.instances).toHaveLength(2);

      // 第2次断开
      act(() => {
        FakeEventSource.instances[1].onerror?.();
      });

      // 第2次重连：2秒后
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(FakeEventSource.instances).toHaveLength(3);

      // 第3次断开
      act(() => {
        FakeEventSource.instances[2].onerror?.();
      });

      // 第3次重连：4秒后
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(FakeEventSource.instances).toHaveLength(4);

      // 第4次断开
      act(() => {
        FakeEventSource.instances[3].onerror?.();
      });

      // 第4次重连：8秒后
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(FakeEventSource.instances).toHaveLength(5);

      // 第5次断开
      act(() => {
        FakeEventSource.instances[4].onerror?.();
      });

      // 第5次重连：16秒后
      act(() => {
        vi.advanceTimersByTime(16000);
      });
      expect(FakeEventSource.instances).toHaveLength(6);

      // 第6次断开 - 已达上限，不应再重连
      act(() => {
        FakeEventSource.instances[5].onerror?.();
      });

      act(() => {
        vi.advanceTimersByTime(32000);
      });

      // 仍然是6个实例，没有第7次重连
      expect(FakeEventSource.instances).toHaveLength(6);

      // error 应该设置为"重连失败"
      expect(result.current.error).toContain('重连');
    } finally {
      vi.useRealTimers();
    }
  });

  test('未收到 onopen/onmessage 前,不应仅凭 readyState 延迟检查标记已连接', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSession('run-1'));

      FakeEventSource.instances[0].readyState = 1;

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(result.current.connected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

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
