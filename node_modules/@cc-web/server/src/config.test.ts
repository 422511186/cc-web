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
    process.env.AUTH_TOKEN = 'test-token';
    process.env.PORT = '4000';
    process.env.CLAUDE_PROJECTS_DIR = '/custom/path';
    process.env.PERMISSION_MODE = 'acceptEdits';

    const config = loadConfig();

    expect(config.authToken).toBe('test-token');
    expect(config.port).toBe(4000);
    expect(config.claudeProjectsDir).toBe('/custom/path');
    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('should use default values when env vars not set', () => {
    process.env.AUTH_TOKEN = 'required-token';
    delete process.env.PORT;
    delete process.env.CLAUDE_PROJECTS_DIR;
    delete process.env.PERMISSION_MODE;

    const config = loadConfig();

    expect(config.authToken).toBe('required-token');
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
    process.env.AUTH_TOKEN = 'token';
    process.env.PORT = '8080';

    const config = loadConfig();

    expect(typeof config.port).toBe('number');
    expect(config.port).toBe(8080);
  });

  it('should handle invalid port gracefully', () => {
    process.env.AUTH_TOKEN = 'token';
    process.env.PORT = 'invalid';

    const config = loadConfig();

    expect(config.port).toBe(3000);
  });
});
