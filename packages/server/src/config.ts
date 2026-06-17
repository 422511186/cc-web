import os from 'node:os';
import path from 'node:path';

export interface Config {
  authToken: string;
  port: number;
  claudeProjectsDir: string;
  imageCacheDir: string;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  // ── 计划二新增:SDK 会话相关 ──
  idleTimeoutMs: number;
  maxConcurrent: number;
  uploadsDir: string;
}

const VALID_PERMISSION_MODES = new Set<Config["permissionMode"]>([
  "default",
  "acceptEdits",
  "bypassPermissions",
]);

export function loadConfig(): Config {
  const authToken = process.env.AUTH_TOKEN || '';
  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  const claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects');
  // Pasted images live in ~/.claude/image-cache (sibling of the projects dir).
  const imageCacheDir = process.env.CLAUDE_IMAGE_CACHE_DIR ||
    path.join(path.dirname(claudeProjectsDir), 'image-cache');
  const permissionMode = (process.env.PERMISSION_MODE || 'default') as Config["permissionMode"];

  const idleTimeoutMs = process.env.SESSION_IDLE_TIMEOUT_MS
    ? Number(process.env.SESSION_IDLE_TIMEOUT_MS)
    : 3 * 60 * 1000;
  const maxConcurrent = process.env.MAX_CONCURRENT_SESSIONS
    ? Number(process.env.MAX_CONCURRENT_SESSIONS)
    : 4;
  const uploadsDir = process.env.UPLOADS_DIR ||
    path.join(process.cwd(), 'uploads');

  if (!authToken) {
    throw new Error('AUTH_TOKEN environment variable is required');
  }

  // 修复 P2-B12: 校验 AUTH_TOKEN 最小长度（防止弱令牌）
  if (authToken.length < 16) {
    throw new Error('AUTH_TOKEN must be at least 16 characters for security');
  }

  // Validate SESSION_IDLE_TIMEOUT_MS: must be positive and finite
  if (idleTimeoutMs <= 0 || !isFinite(idleTimeoutMs)) {
    throw new Error('SESSION_IDLE_TIMEOUT_MS must be positive and finite');
  }

  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new Error('PERMISSION_MODE must be one of: default, acceptEdits, bypassPermissions');
  }

  if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
    throw new Error('MAX_CONCURRENT_SESSIONS must be a positive integer');
  }

  if (!path.isAbsolute(claudeProjectsDir)) {
    throw new Error('CLAUDE_PROJECTS_DIR must be an absolute path');
  }

  return {
    authToken,
    port,
    claudeProjectsDir,
    imageCacheDir,
    permissionMode,
    idleTimeoutMs,
    maxConcurrent,
    uploadsDir,
  };
}
