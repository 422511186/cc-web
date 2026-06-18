import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { Project, Session, SessionDetail } from '@cc-web/shared';
import { parseJsonl } from './jsonl.js';
import { extractTitle } from './title.js';

export class SessionStore {
  /**
   * @param projectsDir 历史记录根目录
   * @param dirExists 可注入的目录存在性判断,便于测试;默认用 fs.existsSync
   */
  constructor(
    private projectsDir: string,
    private dirExists: (p: string) => boolean = fsSync.existsSync,
  ) {}

  async listProjects(): Promise<Project[]> {
    try {
      const entries = await fs.readdir(this.projectsDir);
      const projects: Project[] = [];

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        const fullPath = path.join(this.projectsDir, entry);

        try {
          const stat = await fs.stat(fullPath);

          if (stat.isDirectory()) {
            // 从该项目下的任一 session 文件读取真实的 cwd 作为项目路径
            const realPath = await this.getProjectRealPath(entry);
            const hasEncodedWindowsPath = this.isEncodedWindowsProjectPath(entry);

            // 如果读取失败（没有 session 或读不到 cwd），尝试解码；
            // 但只有“确实是编码路径”的目录名，才用解码后的路径做存在性过滤。
            // 像 demo-project 这类非编码目录名无法可靠反推原始 cwd，不应因此被吞掉。
            const projectPath = realPath || this.decodeProjectPath(entry);
            if ((realPath || hasEncodedWindowsPath) && !this.dirExists(projectPath)) continue;

            projects.push({
              id: entry,
              // 优先用真实路径的末段作为项目名(可保留名字里的连字符,如 cc-web-develop);
              // 没有真实路径时:
              // - Windows 编码目录名退回解码后的末段
              // - 非编码目录名直接保留原样,避免 demo-project → demo/project 这类误伤
              name: realPath
                ? this.basename(realPath)
                : hasEncodedWindowsPath
                  ? this.decodeProjectName(entry)
                  : entry,
              path: projectPath,
            });
          }
        } catch {
          // Skip entries that can't be stat'd
          continue;
        }
      }

      return projects;
    } catch {
      return [];
    }
  }

  /** 从项目目录下的第一个 session 文件读取真实的 cwd。
   *  返回 null 表示无法获取（没有 session 或文件损坏）。 */
  private async getProjectRealPath(projectId: string): Promise<string | null> {
    try {
      const projectPath = path.join(this.projectsDir, projectId);
      const entries = await fs.readdir(projectPath);

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;

        const filePath = path.join(projectPath, entry);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (typeof obj.cwd === 'string' && obj.cwd) {
                return obj.cwd;
              }
            } catch {
              // 跳过损坏行
            }
          }
        } catch {
          // 跳过无法读取的文件
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  async listSessions(projectId: string): Promise<Session[]> {
    try {
      const projectPath = path.join(this.projectsDir, projectId);
      const entries = await fs.readdir(projectPath);
      const sessions: Session[] = [];

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;

        const fullPath = path.join(projectPath, entry);

        try {
          const stat = await fs.stat(fullPath);

          if (!stat.isFile()) continue;

          const sessionId = entry.replace('.jsonl', '');
          const content = await fs.readFile(fullPath, 'utf-8');
          const messages = parseJsonl(content);
          const title = extractTitle(messages);

          sessions.push({
            id: sessionId,
            projectId,
            title,
            createdAt: stat.birthtimeMs,
            updatedAt: stat.mtimeMs,
            messageCount: messages.length,
          });
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  async getSession(projectId: string, sessionId: string): Promise<SessionDetail | null> {
    try {
      const filePath = path.join(this.projectsDir, projectId, `${sessionId}.jsonl`);
      const content = await fs.readFile(filePath, 'utf-8');
      const stat = await fs.stat(filePath);
      const messages = parseJsonl(content);
      const title = extractTitle(messages);

      return {
        id: sessionId,
        projectId,
        title,
        createdAt: stat.birthtimeMs,
        updatedAt: stat.mtimeMs,
        messageCount: messages.length,
        messages,
      };
    } catch {
      return null;
    }
  }

  /** 读取 session 真实工作目录:从 JSONL 第一条带 cwd 的记录提取。
   *  用于续聊时让 SDK 在正确的项目目录下 resume(否则找不到会话)。 */
  async getSessionCwd(projectId: string, sessionId: string): Promise<string | null> {
    try {
      const filePath = path.join(this.projectsDir, projectId, `${sessionId}.jsonl`);
      const content = await fs.readFile(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.cwd === 'string' && obj.cwd) return obj.cwd;
        } catch {
          // 跳过损坏行
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 软删除一条历史会话:把对应的 .jsonl 改名为 .jsonl.deleted。
   *  文件内容保留在磁盘上可恢复,listSessions 只认 .jsonl 故不再展示。
   *  必须防目录穿越:解析后确认目标文件仍落在 projectsDir 内,否则抛错拒绝。
   *  返回 true 表示已软删;文件本就不存在(ENOENT)返回 false。 */
  async deleteSession(projectId: string, sessionId: string): Promise<boolean> {
    if (this.isUnsafePathToken(projectId) || this.isUnsafePathToken(sessionId)) {
      throw new Error('Invalid session path: path traversal detected');
    }

    const root = path.resolve(this.projectsDir);
    const target = path.resolve(this.projectsDir, projectId, `${sessionId}.jsonl`);
    if (!target.startsWith(root + path.sep)) {
      throw new Error('Invalid session path: path traversal detected');
    }

    try {
      await fs.rename(target, `${target}.deleted`);
      return true;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  private decodeProjectName(encoded: string): string {
    if (!this.isEncodedWindowsProjectPath(encoded)) {
      return encoded;
    }
    // Extract last segment from path
    // C--Users-huang-workspace-cc-web-develop -> cc-web-develop
    const decoded = this.decodeProjectPath(encoded);
    return this.basename(decoded);
  }

  /** 取路径的末段(同时兼容 / 和 \ 分隔符)。 */
  private basename(p: string): string {
    const segments = p.split(/[/\\]/);
    return segments[segments.length - 1] || p;
  }

  private decodeProjectPath(encoded: string): string {
    if (!this.isEncodedWindowsProjectPath(encoded)) {
      return encoded;
    }
    // C--Users-huang-workspace-cc-web-develop -> C:/Users/huang/workspace/cc-web-develop
    // 先找到盘符部分（第一个 -- 前的内容 + --）
    const driveMatch = encoded.match(/^([A-Z])--/)!;

    const driveLetter = driveMatch[1];
    const afterDrive = encoded.slice(driveMatch[0].length); // 去掉 "C--" 后的部分
    const pathPart = afterDrive.replace(/-/g, '/'); // 路径部分的 - 都替换为 /

    return `${driveLetter}:/${pathPart}`;
  }

  private isEncodedWindowsProjectPath(encoded: string): boolean {
    return /^[A-Z]--/.test(encoded);
  }

  /** 判断用户输入的路径片段是否安全:禁止分隔符、绝对路径与父级穿越。 */
  private isUnsafePathToken(value: string): boolean {
    if (!value || value === '.' || value === '..') return true;
    if (value.includes('\0')) return true;
    if (value.includes('/') || value.includes('\\')) return true;
    if (/^[A-Za-z]:/.test(value)) return true;
    if (/^\\\\/.test(value)) return true;
    return false;
  }
}
