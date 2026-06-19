import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load config from environment variables', () => {
    process.env.AUTH_TOKEN = 'test-token-123456'; // 16+ 字符
    process.env.PORT = '4000';
    process.env.CLAUDE_PROJECTS_DIR = '/custom/path';
    process.env.PERMISSION_MODE = 'acceptEdits';

    const config = loadConfig();

    expect(config.authToken).toBe('test-token-123456');
    expect(config.port).toBe(4000);
    expect(config.claudeProjectsDir).toBe('/custom/path');
    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('should use default values when env vars not set', () => {
    process.env.AUTH_TOKEN = 'required-token-16'; // 16+ 字符
    delete process.env.PORT;
    delete process.env.CLAUDE_PROJECTS_DIR;
    delete process.env.PERMISSION_MODE;

    const config = loadConfig();

    expect(config.authToken).toBe('required-token-16');
    expect(config.port).toBe(3000);
    expect(config.claudeProjectsDir).toContain('.claude');
    expect(config.claudeProjectsDir).toContain('projects');
    expect(config.permissionMode).toBe('default');
  });

  it('should throw error when AUTH_TOKEN is empty', () => {
    process.env.AUTH_TOKEN = '';

    expect(() => loadConfig()).toThrow('AUTH_TOKEN environment variable is required');
  });

  it('should parse port as number', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.PORT = '8080';

    const config = loadConfig();

    expect(typeof config.port).toBe('number');
    expect(config.port).toBe(8080);
  });

  it('should handle invalid port gracefully', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.PORT = 'invalid';

    const config = loadConfig();

    expect(config.port).toBe(3000);
  });

  it('parses session knobs with defaults', () => {
    process.env.AUTH_TOKEN = 't1234567890abcdef'; // 16+ 字符
    delete process.env.SESSION_IDLE_TIMEOUT_MS;
    delete process.env.SESSION_HEARTBEAT_TTL_MS;
    delete process.env.SESSION_ORPHAN_IDLE_TIMEOUT_MS;
    delete process.env.MAX_CONCURRENT_SESSIONS;
    delete process.env.UPLOADS_DIR;

    const config = loadConfig();

    expect(config.idleTimeoutMs).toBe(3 * 60 * 1000); // 3m
    expect(config.heartbeatTtlMs).toBe(45 * 1000);
    expect(config.orphanIdleTimeoutMs).toBe(60 * 1000);
    expect(config.maxConcurrent).toBe(3);
    expect(config.uploadsDir).toMatch(/uploads$/);
  });

  it('overrides session knobs from env', () => {
    process.env.AUTH_TOKEN = 't1234567890abcdef'; // 16+ 字符
    process.env.SESSION_IDLE_TIMEOUT_MS = '5000';
    process.env.SESSION_HEARTBEAT_TTL_MS = '15000';
    process.env.SESSION_ORPHAN_IDLE_TIMEOUT_MS = '30000';
    process.env.MAX_CONCURRENT_SESSIONS = '2';
    process.env.UPLOADS_DIR = '/tmp/up';

    const config = loadConfig();

    expect(config.idleTimeoutMs).toBe(5000);
    expect(config.heartbeatTtlMs).toBe(15000);
    expect(config.orphanIdleTimeoutMs).toBe(30000);
    expect(config.maxConcurrent).toBe(2);
    expect(config.uploadsDir).toBe('/tmp/up');
  });

  it('parses P2P Signal and Web runtime options from env', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    process.env.P2P_SIGNAL_URL = 'ws://signal.example.test/';
    process.env.P2P_HOST_ID = 'host-custom';
    process.env.P2P_WEB_URL = 'https://web.example.test/app';
    process.env.P2P_ICE_LOCAL_ADDRESS = '172.30.1.2,127.0.0.1';
    process.env.P2P_PAIRING_TTL_MS = '300000';
    process.env.P2P_STATE_FILE = '/tmp/coderelay-p2p-state.json';

    const config = loadConfig();

    expect(config.p2p).toEqual({
      enabled: true,
      signalUrl: 'ws://signal.example.test/',
      hostId: 'host-custom',
      webUrl: 'https://web.example.test/app',
      iceLocalAddresses: ['172.30.1.2', '127.0.0.1'],
      pairingTtlMs: 300000,
      stateFile: '/tmp/coderelay-p2p-state.json',
    });
  });

  it('keeps P2P disabled when no Signal URL is configured', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    delete process.env.P2P_SIGNAL_URL;
    delete process.env.CODERELAY_SIGNAL_URL;

    const config = loadConfig();

    expect(config.p2p.enabled).toBe(false);
  });

  it('defaults P2P pairing web URL to the Web dev port instead of the Host API port', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    process.env.PORT = '3002';
    process.env.P2P_SIGNAL_URL = 'ws://signal.example.test/';
    delete process.env.P2P_WEB_URL;

    const config = loadConfig();

    expect(config.p2p).toEqual(
      expect.objectContaining({
        enabled: true,
        webUrl: 'http://127.0.0.1:3000',
      })
    );
  });

  it('should reject invalid PERMISSION_MODE', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    process.env.PERMISSION_MODE = 'god-mode';

    expect(() => loadConfig()).toThrow(/PERMISSION_MODE/i);
  });

  it('should reject non-positive MAX_CONCURRENT_SESSIONS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    process.env.MAX_CONCURRENT_SESSIONS = '0';

    expect(() => loadConfig()).toThrow(/MAX_CONCURRENT_SESSIONS/i);
  });

  it('should reject non-integer MAX_CONCURRENT_SESSIONS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890';
    process.env.MAX_CONCURRENT_SESSIONS = '1.5';

    expect(() => loadConfig()).toThrow(/MAX_CONCURRENT_SESSIONS/i);
  });

  it('should reject negative SESSION_IDLE_TIMEOUT_MS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.SESSION_IDLE_TIMEOUT_MS = '-1000';

    expect(() => loadConfig()).toThrow('SESSION_IDLE_TIMEOUT_MS must be positive');
  });

  it('should reject zero SESSION_IDLE_TIMEOUT_MS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.SESSION_IDLE_TIMEOUT_MS = '0';

    expect(() => loadConfig()).toThrow('SESSION_IDLE_TIMEOUT_MS must be positive');
  });

  it('should reject infinite SESSION_IDLE_TIMEOUT_MS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.SESSION_IDLE_TIMEOUT_MS = 'Infinity';

    expect(() => loadConfig()).toThrow('SESSION_IDLE_TIMEOUT_MS must be positive');
  });

  it('should reject NaN SESSION_IDLE_TIMEOUT_MS', () => {
    process.env.AUTH_TOKEN = 'token-1234567890'; // 16+ 字符
    process.env.SESSION_IDLE_TIMEOUT_MS = 'not-a-number';

    expect(() => loadConfig()).toThrow('SESSION_IDLE_TIMEOUT_MS must be positive');
  });

  it('P2-B12: 应拒绝过短的 AUTH_TOKEN（少于 16 字符）', () => {
    process.env.AUTH_TOKEN = 'short';

    expect(() => loadConfig()).toThrow(/AUTH_TOKEN.*at least 16/i);
  });

  it('P2-B12: 应接受足够长的 AUTH_TOKEN（16 字符或更多）', () => {
    process.env.AUTH_TOKEN = '1234567890123456'; // 正好 16 字符

    const config = loadConfig();

    expect(config.authToken).toBe('1234567890123456');
  });

  it('应拒绝相对路径的 CLAUDE_PROJECTS_DIR', () => {
    process.env.AUTH_TOKEN = '1234567890123456';
    process.env.CLAUDE_PROJECTS_DIR = './relative-projects';

    expect(() => loadConfig()).toThrow(/CLAUDE_PROJECTS_DIR.*absolute/i);
  });
});
