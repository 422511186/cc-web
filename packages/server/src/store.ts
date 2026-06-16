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
            // 过滤掉真实项目目录已被删除的条目(只保留磁盘上仍存在的项目)
            if (!this.dirExists(this.decodeProjectPath(entry))) continue;

            projects.push({
              id: entry,
              name: this.decodeProjectName(entry),
              path: this.decodeProjectPath(entry),
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
    const root = path.resolve(this.projectsDir);
    const target = path.resolve(this.projectsDir, projectId, `${sessionId}.jsonl`);

    // 确认 target 严格位于 root 之下(防 ../ 穿越)
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
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
    // Extract last segment from path
    // C--Users-huang-Desktop -> Desktop
    const segments = encoded.split('-').filter(s => s);
    return segments[segments.length - 1] || encoded;
  }

  private decodeProjectPath(encoded: string): string {
    // C--Users-huang-Desktop -> C:/Users/huang/Desktop
    return encoded.replace(/--/g, ':/').replace(/-/g, '/');
  }
}
