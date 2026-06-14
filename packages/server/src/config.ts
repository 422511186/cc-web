import os from 'node:os';
import path from 'node:path';

export interface Config {
  authToken: string;
  port: number;
  claudeProjectsDir: string;
  imageCacheDir: string;
  permissionMode: string;
  // ── 计划二新增:SDK 会话相关 ──
  idleTimeoutMs: number;
  maxConcurrent: number;
  uploadsDir: string;
}

export function loadConfig(): Config {
  const authToken = process.env.AUTH_TOKEN || '';
  const port = parseInt(process.env.PORT || '3000', 10) || 3000;
  const claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects');
  // Pasted images live in ~/.claude/image-cache (sibling of the projects dir).
  const imageCacheDir = process.env.CLAUDE_IMAGE_CACHE_DIR ||
    path.join(path.dirname(claudeProjectsDir), 'image-cache');
  const permissionMode = process.env.PERMISSION_MODE || 'default';

  const idleTimeoutMs = process.env.SESSION_IDLE_TIMEOUT_MS
    ? Number(process.env.SESSION_IDLE_TIMEOUT_MS)
    : 30 * 60 * 1000;
  const maxConcurrent = process.env.MAX_CONCURRENT_SESSIONS
    ? Number(process.env.MAX_CONCURRENT_SESSIONS)
    : 4;
  const uploadsDir = process.env.UPLOADS_DIR ||
    path.join(process.cwd(), 'uploads');

  if (!authToken) {
    throw new Error('AUTH_TOKEN environment variable is required');
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
