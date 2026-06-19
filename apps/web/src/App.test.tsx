import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';
import { createApiClient } from './api';
import { clientLog } from './diagnostics';
import type { ActiveAgent } from '@coderelay/shared';
import type { CodeRelayTransport } from '@coderelay/transport';

const mockDisconnect = vi.fn();
const mockOpenP2PPairing = vi.fn();
const mockApiClient = {
  disconnect: mockDisconnect,
  openP2PPairing: mockOpenP2PPairing,
};
let unauthorizedHandler: (() => void) | undefined;
let mockCurrentPairingOffer: unknown = null;
let mockLastTrustedHostProfile: unknown = null;
const mockP2PTransport = {
  request: vi.fn(),
  subscribe: vi.fn(),
} satisfies CodeRelayTransport;
const mockP2PSession = {
  transport: mockP2PTransport,
  connectionId: 'conn-test',
  clientId: 'client-phone',
  close: vi.fn(),
};

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    createApiClient: vi.fn((_token: string, onUnauthorized?: () => void) => {
      unauthorizedHandler = onUnauthorized;
      return mockApiClient;
    }),
  };
});

// Mock components to simplify testing
vi.mock('./components/Login', () => ({
  Login: () => <div data-testid="login">Login</div>,
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: ({ onSessionSelect, onNewSession, onQuickNewSession, activeAgents = [], onActiveAgentSelect }: {
    onSessionSelect: (p: string, s: string) => void;
    onNewSession?: () => void;
    onQuickNewSession?: (cwd: string) => void;
    activeAgents?: ActiveAgent[];
    onActiveAgentSelect?: (agent: ActiveAgent) => void;
  }) => (
    <div data-testid="sidebar">
      <button data-testid="select-A" onClick={() => onSessionSelect('pA', 'sA')}>选A</button>
      <button data-testid="select-B" onClick={() => onSessionSelect('pB', 'sB')}>选B</button>
      <button data-testid="sidebar-new" onClick={() => onNewSession?.()}>侧栏新建</button>
      <button data-testid="sidebar-quick-new" onClick={() => onQuickNewSession?.('C:/proj-from-quick')}>快速新建</button>
      {activeAgents.map((agent) => (
        <button
          key={agent.runId}
          data-testid={`active-${agent.runId}`}
          onClick={() => onActiveAgentSelect?.(agent)}
        >
          active {agent.runId}
        </button>
      ))}
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
  setChatTransport: vi.fn(),
  startContinue: vi.fn((sessionId: string) => Promise.resolve(sessionId)),
  startNew: vi.fn(() => Promise.resolve('run-1')),
  sendMessage: vi.fn(),
  respond: vi.fn(),
  closeSession: vi.fn(() => Promise.resolve()),
  abortSession: vi.fn(() => Promise.resolve()),
  probeRun: vi.fn(() => Promise.resolve(true)),
  listActiveAgents: vi.fn(() => Promise.resolve({ agents: [], maxConcurrent: 3 })),
  closeAgent: vi.fn(() => Promise.resolve()),
  heartbeatSession: vi.fn(() => Promise.resolve({
    ok: true,
    runId: 'run',
    status: 'idle',
    attached: true,
    lastHeartbeatAt: 1,
    leaseExpiresAt: 2,
  })),
}));

vi.mock('./diagnostics', () => ({
  clientLog: vi.fn(),
  setDiagnosticsTransport: vi.fn(),
}));

vi.mock('./p2pClient', () => ({
  currentPairingOffer: vi.fn(() => mockCurrentPairingOffer),
  loadLastTrustedHostProfile: vi.fn(() => mockLastTrustedHostProfile),
  connectBrowserP2P: vi.fn(() => Promise.resolve(mockP2PSession)),
  connectTrustedBrowserP2P: vi.fn(() => Promise.resolve(mockP2PSession)),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,qr')),
  },
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
  closed: boolean;
  closedReason: string | null;
};
beforeEach(() => {
  vi.clearAllMocks();
  unauthorizedHandler = undefined;
  mockCurrentPairingOffer = null;
  mockLastTrustedHostProfile = null;
  mockOpenP2PPairing.mockResolvedValue({
    offer: {
      protocol: 'coderelay-pairing-v1',
      webUrl: 'http://web.test/',
      signalUrl: 'ws://signal.test/',
      hostId: 'host-test',
      hostPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'host-x', y: 'host-y' },
      hostPublicKeyFingerprint: 'host-fingerprint',
      pairingId: 'pair-test',
      pairingSecret: 'secret-test',
      expiresAt: '2026-06-19T00:02:00.000Z',
    },
    pairingUrl: 'http://web.test/?p2p=encoded',
  });
  sessionState = {
    messages: [],
    pending: null,
    connected: true,
    error: null,
    status: 'idle',
    model: null,
    effort: null,
    closed: false,
    closedReason: null,
  };
});
vi.mock('./useSession', () => ({
  setSessionTransport: vi.fn(),
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

    // 应该只有一个汉堡菜单按钮（在状态栏中）
    const menuBtns = container.querySelectorAll('.mobile-menu-button-header');
    expect(menuBtns.length).toBe(1);
    expect(menuBtns[0]).toHaveTextContent('☰');
  });

  test('选中会话内容区作为 flex 子项必须允许收缩,否则内部消息列表无法滚动', () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));

    const conversation = screen.getByTestId('conversation');
    expect(conversation.parentElement).toHaveStyle({ minHeight: '0' });
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
  beforeEach(() => {
    mockDisconnect.mockReset();
  });

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

  test('点击退出登录时主动断开浏览 SSE 连接', () => {
    const store: Record<string, string> = { authToken: 'test-token' };
    Storage.prototype.getItem = vi.fn((k: string) => store[k] ?? null);
    Storage.prototype.setItem = vi.fn((k: string, v: string) => { store[k] = v; });
    Storage.prototype.removeItem = vi.fn((k: string) => { delete store[k]; });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /退出登录/ }));

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  test('初始鉴权已失效时收到 401 应自动清 token 并回到登录页', async () => {
    const store: Record<string, string> = { authToken: 'expired-token' };
    Storage.prototype.getItem = vi.fn((k: string) => store[k] ?? null);
    Storage.prototype.setItem = vi.fn((k: string, v: string) => { store[k] = v; });
    Storage.prototype.removeItem = vi.fn((k: string) => { delete store[k]; });

    render(<App />);

    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
    expect(createApiClient).toHaveBeenCalledWith('expired-token', expect.any(Function));

    act(() => {
      unauthorizedHandler?.();
    });

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(store.authToken).toBeUndefined();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  test('后台运行轮询收到 401 时也应自动清 token 并回到登录页', async () => {
    const chatApi = await import('./chatApi');
    const unauthorizedError = Object.assign(new Error('Unauthorized'), { status: 401 });
    vi.mocked(chatApi.listActiveAgents).mockRejectedValueOnce(unauthorizedError);

    const store: Record<string, string> = { authToken: 'expired-token' };
    Storage.prototype.getItem = vi.fn((k: string) => store[k] ?? null);
    Storage.prototype.setItem = vi.fn((k: string, v: string) => { store[k] = v; });
    Storage.prototype.removeItem = vi.fn((k: string) => { delete store[k]; });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(store.authToken).toBeUndefined();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  test('后台运行刷新结果未变化时不应产生额外异步状态更新警告', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Storage.prototype.getItem = vi.fn(() => 'test-token');

    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((message) => message.includes('not wrapped in act'))).toBe(false);
    errorSpy.mockRestore();
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

describe('App P2P 配对与传输切换', () => {
  beforeEach(() => {
    window.history.pushState({}, '', window.location.pathname);
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      return null;
    });
    Storage.prototype.setItem = vi.fn();
    Storage.prototype.removeItem = vi.fn();
  });

  test('点击添加设备后显示 Host 生成的配对链接和二维码', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '添加设备' }));

    expect(mockOpenP2PPairing).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('dialog', { name: '添加设备' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://web.test/?p2p=encoded')).toBeInTheDocument();
    expect(await screen.findByAltText('配对二维码')).toHaveAttribute('src', 'data:image/png;base64,qr');
  });

  test('扫码链接进入后连接 P2P 并把业务请求切到 P2PTransport', async () => {
    const chatApi = await import('./chatApi');
    const sessionModule = await import('./useSession');
    const diagnostics = await import('./diagnostics');
    const p2pClient = await import('./p2pClient');
    mockCurrentPairingOffer = {
      protocol: 'coderelay-pairing-v1',
      webUrl: 'http://web.test/',
      signalUrl: 'ws://signal.test/',
      hostId: 'host-test',
      hostPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'host-x', y: 'host-y' },
      hostPublicKeyFingerprint: 'host-fingerprint',
      pairingId: 'pair-test',
      pairingSecret: 'secret-test',
      expiresAt: '2026-06-19T00:02:00.000Z',
    };
    window.history.pushState({}, '', '?p2p=encoded');

    render(<App />);

    expect(await screen.findByText('P2P 已连接')).toBeInTheDocument();
    expect(p2pClient.connectBrowserP2P).toHaveBeenCalledWith(mockCurrentPairingOffer);
    expect(chatApi.setChatTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(sessionModule.setSessionTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(diagnostics.setDiagnosticsTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(createApiClient).toHaveBeenCalledWith('test-token', expect.any(Function), mockP2PTransport);
  });

  test('普通首页存在已绑定 Host 时自动恢复 P2P 并把业务请求切到 P2PTransport', async () => {
    const chatApi = await import('./chatApi');
    const sessionModule = await import('./useSession');
    const diagnostics = await import('./diagnostics');
    const p2pClient = await import('./p2pClient');
    mockLastTrustedHostProfile = {
      protocol: 'coderelay-trusted-host-v1',
      webUrl: 'http://web.test/',
      signalUrl: 'ws://signal.test/',
      hostId: 'host-test',
      hostPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'host-x', y: 'host-y' },
      hostPublicKeyFingerprint: 'host-fingerprint',
      updatedAt: '2026-06-19T00:00:00.000Z',
    };

    render(<App />);

    expect(await screen.findByText('P2P 已连接')).toBeInTheDocument();
    expect(await screen.findByText('协议：P2P')).toBeInTheDocument();
    expect(p2pClient.connectTrustedBrowserP2P).toHaveBeenCalledWith(mockLastTrustedHostProfile);
    expect(p2pClient.connectBrowserP2P).not.toHaveBeenCalled();
    expect(chatApi.setChatTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(sessionModule.setSessionTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(diagnostics.setDiagnosticsTransport).toHaveBeenCalledWith(mockP2PTransport);
    expect(createApiClient).toHaveBeenCalledWith('test-token', expect.any(Function), mockP2PTransport);
  });

  test('普通 HTTP 模式也明确显示当前协议', async () => {
    render(<App />);

    expect(await screen.findByText('协议：HTTP')).toBeInTheDocument();
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

  test('在 A 忙碌续聊后切到 B 再切回 A,应自动恢复已有 runId 而无需重新点继续', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const chatApi = await import('./chatApi');
    render(<App />);

    // 选中会话 A 并续聊
    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    sessionState.status = 'executing';
    fireEvent.click(continueBtn);
    // 续聊后 runId 落定(=sA),"接管/继续"按钮消失
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );
    expect(chatApi.startContinue).toHaveBeenCalledTimes(1);

    // 切到 B
    fireEvent.click(screen.getByTestId('select-B'));
    await screen.findByRole('button', { name: '接管/继续' });

    // 切回 A:应自动恢复已有 runId,不需要重新点继续,也不应再次 startContinue
    fireEvent.click(screen.getByTestId('select-A'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );
    expect(chatApi.startContinue).toHaveBeenCalledTimes(1);
  });

  test('切回本地已知 active run 的会话时不应等待探活返回才接管', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const chatApi = await import('./chatApi');
    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    sessionState.status = 'executing';
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );

    vi.mocked(chatApi.probeRun).mockImplementation(() => new Promise<boolean>(() => {}));

    fireEvent.click(screen.getByTestId('select-B'));
    await screen.findByRole('button', { name: '接管/继续' });

    fireEvent.click(screen.getByTestId('select-A'));

    expect(chatApi.probeRun).toHaveBeenCalledWith('sA');
    expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument();
    expect(chatApi.startContinue).toHaveBeenCalledTimes(1);
  });

  test('在 A 空闲续聊后切到 B 再切回 A,应自动恢复已有 runId', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );

    // 默认 idle:切走时会被 release 回收
    sessionState.status = 'idle';

    fireEvent.click(screen.getByTestId('select-B'));
    await screen.findByRole('button', { name: '接管/继续' });

    fireEvent.click(screen.getByTestId('select-A'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );
  });

  test('切换会话时不应主动释放当前运行中的后台会话', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    const chatApi = await import('./chatApi');
    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    sessionState.status = 'executing';
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId('select-B'));

    expect(chatApi.closeSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('select-A'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );
    expect(chatApi.startContinue).toHaveBeenCalledTimes(1);
  });

  test('续聊起跑那刻锁定 historyBoundary,后续历史增长不覆盖', async () => {
    Storage.prototype.getItem = vi.fn(() => 'test-token');
    render(<App />);

    // 选中会话 A:Conversation 上报起跑前历史长度为 2
    fireEvent.click(screen.getByTestId('select-A'));
    fireEvent.click(screen.getByTestId('report-2'));

    // 续聊:此刻应把边界锁定为 2
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
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
    // 进入已选中会话态,才会出现"接管/继续"按钮
    window.history.pushState({}, '', '?project=p1&session=s1');

    render(<App />);

    const btn = await screen.findByRole('button', { name: '接管/继续' });
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
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
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

  test('closed=true(detached) 时状态栏显示「已结束」而非「连接中…」', async () => {
    // 服务端优雅分离:connected=false 且已收到 closed 事件
    sessionState.connected = false;
    sessionState.closed = true;
    sessionState.closedReason = 'detached';
    await enterActiveSession();
    expect(screen.queryByText('连接中…')).not.toBeInTheDocument();
    expect(screen.getByText('已结束')).toBeInTheDocument();
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
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
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

  test('停止后不应掉出连接态，仍保留当前会话输入能力', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.abortSession).mockResolvedValue();

    await enterExecutingState();

    fireEvent.click(screen.getByText('⏹ 停止'));
    fireEvent.click(screen.getByRole('button', { name: /确定/i }));

    sessionState.status = 'idle';
    sessionState.connected = true;

    await waitFor(() => expect(screen.getByText('已接管')).toBeInTheDocument());
    expect(screen.getByText('空闲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
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
    await screen.findByRole('button', { name: '接管/继续' });

    // 状态栏不应显示"快速新建"按钮；侧栏 mock 会提供同名入口。
    const statusBar = document.querySelector('.status-bar')!;
    expect(within(statusBar).queryByRole('button', { name: /快速新建/i })).not.toBeInTheDocument();
  });

  test('空状态新建对话只打开新建面板,不直接启动 run', async () => {
    const chatApi = await import('./chatApi');
    window.history.pushState({}, '', window.location.pathname);

    render(<App />);

    const newButton = screen.getByRole('button', { name: /新建对话/ });
    fireEvent.click(newButton);

    expect(await screen.findByRole('dialog', { name: '新建会话' })).toBeInTheDocument();
    expect(chatApi.startNew).not.toHaveBeenCalled();
  });

  test('在新建面板输入目录并确认后启动新建 run', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startNew).mockResolvedValueOnce('run-manual');
    window.history.pushState({}, '', window.location.pathname);

    render(<App />);

    fireEvent.click(screen.getByTestId('sidebar-new'));
    const input = await screen.findByLabelText('工作目录路径');
    fireEvent.change(input, { target: { value: 'C:/manual/project' } });
    fireEvent.click(screen.getByRole('button', { name: '创建会话' }));

    await waitFor(() => expect(chatApi.startNew).toHaveBeenCalledWith('C:/manual/project'));
    expect(window.location.search).toBe('');
  });

  test('快速新建项目仍直接使用项目路径启动新建 run', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startNew).mockResolvedValueOnce('run-quick-new');
    window.history.pushState({}, '', '?project=pA&session=sA');

    render(<App />);

    fireEvent.click(screen.getByTestId('sidebar-quick-new'));
    await waitFor(() =>
      expect(chatApi.startNew).toHaveBeenCalledWith('C:/proj-from-quick')
    );
  });

  test('新建/快速新建后的空实时会话区域应显式白底,避免出现黑色聊天框', async () => {
    window.history.pushState({}, '', window.location.pathname);

    render(<App />);

    fireEvent.click(screen.getByTestId('sidebar-quick-new'));

    const view = await screen.findByTestId('new-session-view');
    expect(view).toHaveStyle({ backgroundColor: '#fff' });
  });

  test('选中历史/活跃会话的内容区应显式白底,避免切换回来出现黑色聊天框', async () => {
    window.history.pushState({}, '', window.location.pathname);

    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));

    const content = await screen.findByTestId('session-content');
    expect(screen.getByTestId('conversation')).toBeInTheDocument();
    expect(content).toHaveStyle({ backgroundColor: '#fff' });
  });
});

describe('App activeRuns 持久化', () => {
  beforeEach(() => {
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      return null;
    });
    Storage.prototype.setItem = vi.fn();
    Storage.prototype.removeItem = vi.fn();
  });

  test('续聊时将 runId 存入 sessionStorage', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startContinue).mockResolvedValueOnce('run-123');

    render(<App />);

    // 选中会话
    fireEvent.click(screen.getByTestId('select-A'));
    await screen.findByRole('button', { name: '接管/继续' });

    // 点击"接管/继续"
    fireEvent.click(screen.getByRole('button', { name: '接管/继续' }));

    // 应该将 activeRuns 存入 sessionStorage
    await waitFor(() => {
      expect(Storage.prototype.setItem).toHaveBeenCalledWith(
        'cc-web-activeRuns',
        expect.stringContaining('run-123')
      );
    });
  });

  test('页面刷新后自动读取 activeRuns 并重连', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.startContinue).mockClear();

    // Mock sessionStorage 有已保存的 activeRuns
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      if (key === 'cc-web-activeRuns') return JSON.stringify({ 'sA': 'run-456' });
      return null;
    });

    // Mock URL 有 session 参数
    window.history.pushState({}, '', '?project=pA&session=sA');

    render(<App />);

    // 应直接恢复已有 runId 进行 SSE 重接,而不是重复 startContinue
    await screen.findByTestId('conversation');
    expect(chatApi.startContinue).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument();
  });

  test('activeRuns 数据损坏时优雅降级不崩溃', async () => {
    // Mock 损坏的 JSON
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      if (key === 'cc-web-activeRuns') return '{invalid json';
      return null;
    });

    window.history.pushState({}, '', '?project=pA&session=sA');

    // 不应抛错，正常渲染
    expect(() => render(<App />)).not.toThrow();

    // 不应自动重连（因为数据损坏）
    expect(screen.getByRole('button', { name: '接管/继续' })).toBeInTheDocument();
  });

  test('恢复到已失效的 active run 时应快速清理并回退到“接管/继续”', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.probeRun).mockResolvedValueOnce(false);

    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      if (key === 'cc-web-activeRuns') return JSON.stringify({ sA: 'run-dead' });
      return null;
    });
    Storage.prototype.setItem = vi.fn();

    window.history.pushState({}, '', '?project=pA&session=sA');

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '接管/继续' })).toBeInTheDocument()
    );

    expect(chatApi.probeRun).toHaveBeenCalledWith('run-dead');
    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      '{}'
    );
  });

  test('旧会话的探活结果延迟返回时，不应污染当前已切换到的新会话', async () => {
    const chatApi = await import('./chatApi');
    const probeResolvers: Array<(value: boolean) => void> = [];
    vi.mocked(chatApi.probeRun).mockImplementation(
      () => new Promise<boolean>((resolve) => { probeResolvers.push(resolve); })
    );

    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      if (key === 'cc-web-activeRuns') return JSON.stringify({ sA: 'run-A' });
      return null;
    });

    window.history.pushState({}, '', '?project=pA&session=sA');
    render(<App />);
    await waitFor(() => expect(chatApi.probeRun).toHaveBeenCalledWith('run-A'));

    // 用户立刻切到 B，B 没有 active run，应保持“接管/继续”
    fireEvent.click(screen.getByTestId('select-B'));
    expect(screen.getByRole('button', { name: '接管/继续' })).toBeInTheDocument();

    // 旧的 A 探活晚到返回 true，也不应把 B 误切成已接管态
    await act(async () => {
      probeResolvers[0](true);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '接管/继续' })).toBeInTheDocument();
    window.history.pushState({}, '', window.location.pathname);
  });

  test('历史续聊 run 结束后应清理 activeRuns 并重新显示继续按钮', async () => {
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      return null;
    });
    Storage.prototype.setItem = vi.fn();

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));
    const continueBtn = await screen.findByRole('button', { name: '接管/继续' });
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );

    sessionState.connected = false;
    sessionState.closed = true;
    sessionState.closedReason = 'exited';
    rerender(<App />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '接管/继续' })).toBeInTheDocument()
    );
    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      '{}'
    );
  });
});

describe('App 后台运行管理', () => {
  beforeEach(() => {
    window.history.pushState({}, '', window.location.pathname);
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      return null;
    });
    Storage.prototype.setItem = vi.fn();
    Storage.prototype.removeItem = vi.fn();
  });

  test('切换会话时不应调用 closeSession，只切换当前查看目标', async () => {
    const chatApi = await import('./chatApi');
    render(<App />);

    fireEvent.click(screen.getByTestId('select-A'));
    await screen.findByRole('button', { name: '接管/继续' });

    fireEvent.click(screen.getByTestId('select-B'));
    fireEvent.click(screen.getByTestId('select-A'));

    expect(chatApi.closeSession).not.toHaveBeenCalled();
  });

  test('当前 URL 会话如果已在后端后台运行列表中，应自动接管而不是继续显示连接按钮', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.listActiveAgents).mockResolvedValue({
      maxConcurrent: 3,
      agents: [{
        runId: 'run-A',
        kind: 'continue',
        sessionId: 'sA',
        projectId: 'pA',
        status: 'idle',
        createdAt: 1,
        lastEventAt: 1,
      }],
    });

    window.history.pushState({}, '', '?project=pA&session=sA');

    render(<App />);

    await screen.findByTestId('conversation');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument()
    );
    expect(chatApi.startContinue).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      expect.stringContaining('run-A')
    );
  });

  test('点击后台运行列表中的历史续聊 run 后，应补写 activeRuns 映射供后续切回自动接管', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.listActiveAgents).mockResolvedValue({
      maxConcurrent: 3,
      agents: [{
        runId: 'run-A',
        kind: 'continue',
        sessionId: 'sA',
        projectId: 'pA',
        status: 'executing',
        createdAt: 1,
        lastEventAt: 1,
      }],
    });

    render(<App />);

    fireEvent.click(await screen.findByTestId('active-run-A'));

    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      expect.stringContaining('run-A')
    );
  });

  test('点击已在后台运行列表中的历史会话时应立即接管，不等待下一次轮询', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.listActiveAgents).mockResolvedValue({
      maxConcurrent: 3,
      agents: [{
        runId: 'run-A',
        kind: 'continue',
        sessionId: 'sA',
        projectId: 'pA',
        status: 'idle',
        createdAt: 1,
        lastEventAt: 1,
      }],
    });

    render(<App />);

    await screen.findByTestId('active-run-A');

    fireEvent.click(screen.getByTestId('select-A'));

    expect(clientLog).toHaveBeenCalledWith(
      'app.session-select',
      expect.objectContaining({
        projectId: 'pA',
        sessionId: 'sA',
        matchedRunId: 'run-A',
      })
    );
    expect(clientLog).toHaveBeenCalledWith(
      'app.attach-active-agent',
      expect.objectContaining({
        runId: 'run-A',
        sessionId: 'sA',
        source: 'history-row',
      })
    );
    expect(screen.queryByRole('button', { name: '接管后台运行' })).not.toBeInTheDocument();
    expect(screen.getByText('已接管')).toBeInTheDocument();
    expect(chatApi.startContinue).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      expect.stringContaining('run-A')
    );
  });
});

describe('App activeRuns 心跳保活', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.pushState({}, '', window.location.pathname);
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'authToken') return 'test-token';
      return null;
    });
    Storage.prototype.setItem = vi.fn();
    Storage.prototype.removeItem = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('切到其他会话后仍对本地 activeRuns 中的 run 发送 heartbeat', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.listActiveAgents).mockResolvedValue({ agents: [], maxConcurrent: 3 });
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-A'));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接管/继续' }));
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument();

    vi.mocked(chatApi.heartbeatSession).mockClear();
    fireEvent.click(screen.getByTestId('select-B'));

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(chatApi.heartbeatSession).toHaveBeenCalledWith('sA');
  });

  test('heartbeat 返回 404 时清理 stale activeRuns 映射', async () => {
    const chatApi = await import('./chatApi');
    vi.mocked(chatApi.listActiveAgents).mockResolvedValue({ agents: [], maxConcurrent: 3 });
    vi.mocked(chatApi.heartbeatSession).mockRejectedValueOnce(
      Object.assign(new Error('not found'), { status: 404 })
    );

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-A'));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接管/继续' }));
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: '接管/继续' })).not.toBeInTheDocument();

    vi.mocked(Storage.prototype.setItem).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(Storage.prototype.setItem).toHaveBeenCalledWith(
      'cc-web-activeRuns',
      '{}'
    );
  });
});
