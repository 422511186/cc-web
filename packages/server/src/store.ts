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

            // 如果读取失败（没有 session 或读不到 cwd），尝试解码；
            // 但如果解码后的路径不存在，跳过该项目
            const projectPath = realPath || this.decodeProjectPath(entry);
            if (!this.dirExists(projectPath)) continue;

            projects.push({
              id: entry,
              // 优先用真实路径的末段作为项目名(可保留名字里的连字符,如 cc-web-develop);
              // 没有真实路径时退回到对目录名的解码(此时名字里的连字符无法区分,会丢失)
              name: realPath ? this.basename(realPath) : this.decodeProjectName(entry),
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
    // C--Users-huang-workspace-cc-web-develop -> C:/Users/huang/workspace/cc-web-develop
    // 先找到盘符部分（第一个 -- 前的内容 + --）
    const driveMatch = encoded.match(/^([A-Z])--/);
    if (!driveMatch) {
      // 没有盘符，直接替换所有 - 为 /
      return encoded.replace(/-/g, '/');
    }

    const driveLetter = driveMatch[1];
    const afterDrive = encoded.slice(driveMatch[0].length); // 去掉 "C--" 后的部分
    const pathPart = afterDrive.replace(/-/g, '/'); // 路径部分的 - 都替换为 /

    return `${driveLetter}:/${pathPart}`;
  }
}
