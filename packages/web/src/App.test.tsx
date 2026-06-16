import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

// Mock components to simplify testing
vi.mock('./components/Login', () => ({
  Login: () => <div data-testid="login">Login</div>,
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ onSessionSelect }: { onSessionSelect: (p: string, s: string) => void }) => (
    <div data-testid="sidebar">
      <button data-testid="select-A" onClick={() => onSessionSelect('pA', 'sA')}>选A</button>
      <button data-testid="select-B" onClick={() => onSessionSelect('pB', 'sB')}>选B</button>
    </div>
  ),
}));

vi.mock('./components/Conversation', () => ({
  Conversation: ({ historyBoundary, onHistoryLoaded, sessionId }: {
    historyBoundary?: number;
    onHistoryLoaded?: (sessionId: string, length: number) => void;
    sessionId: string;
  }) => (
    <div data-testid="conversation">
      <span data-testid="boundary">{historyBoundary === undefined ? 'none' : String(historyBoundary)}</span>
      <button data-testid="report-2" onClick={() => onHistoryLoaded?.(sessionId, 2)}>report2</button>
      <button data-testid="report-5" onClick={() => onHistoryLoaded?.(sessionId, 5)}>report5</button>
    </div>
  ),
}));

vi.mock('./chatApi', () => ({
  startContinue: vi.fn((sessionId: string) => Promise.resolve(sessionId)),
  startNew: vi.fn(() => Promise.resolve('run-1')),
  sendMessage: vi.fn(),
  respond: vi.fn(),
  closeSession: vi.fn(() => Promise.resolve()),
  abortSession: vi.fn(() => Promise.resolve()),
}));

// 可控的 useSession mock:各测试可改写 sessionState 来驱动状态栏文案
let sessionState: {
  messages: unknown[];
  pending: unknown;
  connected: boolean;
  error: string | null;
  status: 'idle' | 'executing' | 'waiting';
  model: string | null;
  effort: string | null;
};
beforeEach(() => {
  sessionState = {
    messages: [],
    pending: null,
    connected: true,
    error: null,
    status: 'idle',
    model: null,
    effort: null,
  };
});
vi.mock('./useSession', () => ({
  useSession: () => sessionState,
}));

describe('App responsive layout', () => {
  beforeEach(() => {
    // Mock sessionStorage
    Storage.prototype.getItem = vi.fn(() => 'test-token');
  });

  test('renders mobile layout on small screens', () => {
    const { container } = render(<App />);

    // Check that app renders with sidebar
    const sidebar = container.querySelector('[data-testid="sidebar"]');
    expect(sidebar).toBeInTheDocument();
  });

  test('renders desktop layout on large screens', () => {
    // Mock desktop media query
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false, // Desktop
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = render(<App />);

    const sidebar = container.querySelector('[data-testid="sidebar"]');
    expect(sidebar).toBeInTheDocument();
  });

  test('选中会话时只显示一个汉堡菜单按钮', () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const { container } = render(<App />);

    // 选中会话后，应该只渲染选中会话的状态栏（不渲染空状态页）
    fireEvent.click(screen.getByTestId('select-A'));

    // 只有一个状态栏被渲染，所以只有一个汉堡菜单按钮
    const statusBars = container.querySelectorAll('.status-bar');
    expect(statusBars.length).toBe(1);

    const menuBtns = container.querySelectorAll('.mobile-menu-button-header');
    expect(menuBtns.length).toBe(1);
    expect(menuBtns[0]).toHaveTextContent('☰');
  });

  test('空状态页只显示一个汉堡菜单按钮', () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const { container } = render(<App />);

    // 未选择会话时，只渲染空状态页的状态栏
    const statusBars = container.querySelectorAll('.status-bar');
    expect(statusBars.length).toBe(1);

    const menuBtns = container.querySelectorAll('.mobile-menu-button-header');
    expect(menuBtns.length).toBe(1);
    expect(menuBtns[0]).toHaveTextContent('☰');
  });

  test('点击汉堡菜单按钮调用 window.__toggleMobileMenu', () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const mockToggle = vi.fn();

    const { container } = render(<App />);

    // 在渲染后设置 mock
    (window as any).__toggleMobileMenu = mockToggle;

    // 选中会话
    fireEvent.click(screen.getByTestId('select-A'));

    const menuBtn = container.querySelector('button[aria-label="菜单"]');
    expect(menuBtn).toBeInTheDocument();

    fireEvent.click(menuBtn!);

    expect(mockToggle).toHaveBeenCalledTimes(1);
  });
});

describe('App 退出登录', () => {
  test('点击退出登录后清除 token 并回到登录页', () => {
    // 有状态的 sessionStorage mock:logout 后 getItem 真返回 null
    const store: Record<string, string> = { authToken: 'test-token' };
    Storage.prototype.getItem = vi.fn((k: string) => store[k] ?? null);
    Storage.prototype.setItem = vi.fn((k: string, v: string) => { store[k] = v; });
    Storage.prototype.removeItem = vi.fn((k: string) => { delete store[k]; });

    render(<App />);

    // 已登录:不显示登录页,能看到退出按钮
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /退出登录/ }));

    // token 已清除,回到登录页
    expect(store.authToken).toBeUndefined();
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });

  test('退出登录按钮在侧栏内且有合理样式(非简陋灰按钮)', () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const { container } = render(<App />);

    const logoutBtn = screen.getByRole('button', { name: /退出登录/ });

    // 退出按钮应在侧栏容器内(不在主内容区)
    const sidebar = container.querySelector('.sidebar-container');
    expect(sidebar).toContainElement(logoutBtn);

    // 样式检查:不应是简陋的灰色小按钮(#666 color + #ddd border)
    const styles = window.getComputedStyle(logoutBtn);
    // 应该有视觉区分,不是纯灰色 #666
    expect(styles.color).not.toBe('rgb(102, 102, 102)');
    // 应该有红色主题（警示色）
    expect(styles.color).toBe('rgb(220, 53, 69)'); // #dc3545
  });
});

describe('App 切走再切回重连接管', () => {
  beforeEach(() => {
    // useSession 会 new EventSource;jsdom 无此实现,给个最小桩
    class FakeES {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {}
      close() {}
    }
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeES as unknown;
  });

  test('在 A 续聊后切到 B 再切回 A,需要重新点"在此继续"(不自动恢复runId)', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    render(<App />);

    // 选中会话 A 并续聊
    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '🔗 在此继续' });
    fireEvent.click(continueBtn);
    // 续聊后 runId 落定(=sA),"在此继续"按钮消失
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '🔗 在此继续' })).not.toBeInTheDocument()
    );

    // 切到 B
    fireEvent.click(screen.getByTestId('select-B'));
    await screen.findByRole('button', { name: '🔗 在此继续' });

    // 切回 A:runId 已清空,需要重新点"在此继续"
    fireEvent.click(screen.getByTestId('select-A'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '🔗 在此继续' })).toBeInTheDocument()
    );
  });

  test('续聊起跑那刻锁定 historyBoundary,后续历史增长不覆盖', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    render(<App />);

    // 选中会话 A:Conversation 上报起跑前历史长度为 2
    fireEvent.click(screen.getByTestId('select-A'));
    fireEvent.click(screen.getByTestId('report-2'));

    // 续聊:此刻应把边界锁定为 2
    const continueBtn = await screen.findByRole('button', { name: '🔗 在此继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '🔗 在此继续' })).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('boundary')).toHaveTextContent('2');

    // 本轮执行后历史落盘增长到 5,Conversation 再次上报;边界仍应锁定在 2
    fireEvent.click(screen.getByTestId('report-5'));
    await waitFor(() => expect(screen.getByTestId('boundary')).toHaveTextContent('2'));
  });
});

describe('App 续聊原目录已删除', () => {
  test('续聊失败时展示提示而非崩溃', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startContinue).mockRejectedValueOnce(
      new Error('原项目目录已不存在,无法续聊')
    );
    // 进入已选中会话态,才会出现"在此继续"按钮
    window.history.pushState({}, '', '?project=p1&session=s1');

    render(<App />);

    const btn = await screen.findByRole('button', { name: '🔗 在此继续' });
    fireEvent.click(btn);

    // 续聊被拒后,展示原目录已删除的提示
    expect(await screen.findByText(/原项目目录已不存在/)).toBeInTheDocument();

    // 还原 URL,避免影响其它测试
    window.history.pushState({}, '', window.location.pathname);
  });
});

describe('App 执行状态与模型展示', () => {
  beforeEach(() => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    class FakeES {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {}
      close() {}
    }
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeES as unknown;
  });

  async function enterActiveSession() {
    render(<App />);
    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '🔗 在此继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '🔗 在此继续' })).not.toBeInTheDocument()
    );
  }

  test('status=executing 时状态栏显示「执行中…」', async () => {
    sessionState.status = 'executing';
    await enterActiveSession();
    expect(screen.getByText('执行中…')).toBeInTheDocument();
  });

  test('status=waiting 时状态栏显示「等待你回答」', async () => {
    sessionState.status = 'waiting';
    await enterActiveSession();
    expect(screen.getByText('等待你回答')).toBeInTheDocument();
  });

  test('status=idle 时状态栏显示「空闲」', async () => {
    sessionState.status = 'idle';
    await enterActiveSession();
    expect(screen.getByText('空闲')).toBeInTheDocument();
  });

  test('状态栏只展示模型,不展示强度(SDK 无此字段)', async () => {
    sessionState.model = 'claude-opus-4-8';
    sessionState.effort = null;
    await enterActiveSession();
    expect(screen.getByText(/模型:\s*claude-opus-4-8/)).toBeInTheDocument();
    // 强度字段不应出现在状态栏
    expect(screen.queryByText(/强度/)).not.toBeInTheDocument();
  });

  test('effort 有值时展示推理强度', async () => {
    sessionState.model = 'claude-opus-4-8';
    sessionState.effort = 'high';
    await enterActiveSession();
    expect(screen.getByText(/模型:\s*claude-opus-4-8/)).toBeInTheDocument();
    expect(screen.getByText(/强度:\s*high/)).toBeInTheDocument();
  });
});

describe('App 停止执行', () => {
  beforeEach(() => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    class FakeES {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {}
      close() {}
    }
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeES as unknown;
  });

  async function enterExecutingState() {
    sessionState.status = 'executing';
    render(<App />);
    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '🔗 在此继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '🔗 在此继续' })).not.toBeInTheDocument()
    );
  }

  test('executing 状态下 Composer 显示停止按钮', async () => {
    await enterExecutingState();
    expect(screen.getByText('⏹ 停止')).toBeInTheDocument();
    expect(screen.queryByText('发送')).not.toBeInTheDocument();
  });

  test('点击停止按钮调用 abortSession', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.abortSession).mockResolvedValue();

    await enterExecutingState();

    // 点击停止按钮
    fireEvent.click(screen.getByText('⏹ 停止'));

    // 应该显示确认对话框
    expect(screen.getByText('确认停止')).toBeInTheDocument();

    // 点击确定
    fireEvent.click(screen.getByRole('button', { name: /确定/i }));

    await waitFor(() => expect(chatApi.abortSession).toHaveBeenCalled());
  });

  test('停止成功后显示「已停止」提示', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.abortSession).mockResolvedValue();

    await enterExecutingState();

    // 点击停止按钮
    fireEvent.click(screen.getByText('⏹ 停止'));

    // 点击确定
    fireEvent.click(screen.getByRole('button', { name: /确定/i }));

    // 停止后应显示提示信息
    await waitFor(() => expect(screen.getByText(/已停止/)).toBeInTheDocument());
  });
});

describe('App 新建会话两按钮区分', () => {
  beforeEach(() => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    // Mock window.prompt for directory input
    global.window.prompt = vi.fn();
  });

  test('状态栏不显示快速新建按钮', async () => {
    render(<App />);

    // 选中会话
    fireEvent.click(screen.getByTestId('select-A'));
    await screen.findByRole('button', { name: '🔗 在此继续' });

    // 状态栏不应显示"快速新建"按钮
    expect(screen.queryByRole('button', { name: /快速新建/i })).not.toBeInTheDocument();
  });

  test('快速新建失败时 AlertDialog 展示错误信息而非崩溃', async () => {
    vi.mocked(window.prompt).mockReturnValue('/some/path');

    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startNew).mockRejectedValueOnce(new Error('目录不存在'));

    // 清空 URL,确保进入空状态(未选中会话)
    window.history.pushState({}, '', window.location.pathname);

    render(<App />);

    // 空状态下显示"＋ 新建对话"按钮
    const newButton = screen.getByRole('button', { name: /新建对话/ });
    fireEvent.click(newButton);

    // 应该显示 AlertDialog 而非 window.alert
    await waitFor(() => expect(screen.getByText(/新建失败/)).toBeInTheDocument());
    expect(screen.getByText(/目录不存在/)).toBeInTheDocument();
  });
});
