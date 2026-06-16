import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from './store.js';
import type { Message } from '@cc-web/shared';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises');

describe('SessionStore', () => {
  const mockProjectsDir = '/mock/.claude/projects';
  let store: SessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认所有目录都存在,保持既有用例语义不变
    store = new SessionStore(mockProjectsDir, () => true);
  });

  describe('项目路径解码', () => {
    it('should read real path from session cwd when available', async () => {
      // 测试带连字符的项目名（如 cc-web-develop）从 session 文件读取真实路径
      vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
        if (p.includes('C--Users-huang-workspace-cc-web-develop')) {
          return ['session1.jsonl'] as any;
        }
        return ['C--Users-huang-workspace-cc-web-develop'] as any;
      });

      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);

      vi.mocked(fs.readFile).mockResolvedValue(
        '{"cwd":"C:/Users/huang/workspace/cc-web-develop","type":"session-start"}\n'
      );

      const projects = await store.listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        id: 'C--Users-huang-workspace-cc-web-develop',
        name: 'cc-web-develop',
        path: 'C:/Users/huang/workspace/cc-web-develop',
      });
    });

    it('should fallback to decoding when no session files exist', async () => {
      vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
        if (p.includes('C--Users-huang-Desktop')) {
          return [] as any; // 没有 session 文件
        }
        return ['C--Users-huang-Desktop'] as any;
      });

      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);

      const projects = await store.listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        id: 'C--Users-huang-Desktop',
        name: 'Desktop',
        path: 'C:/Users/huang/Desktop',
      });
    });
  });

  describe('listProjects', () => {
    it('should return list of projects from directory names', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        'C--Users-huang-Desktop' as any,
        'C--Users-huang-workspace' as any,
        '.hidden' as any,
        'file.txt' as any,
      ]);

      vi.mocked(fs.stat).mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes('C--Users-huang-Desktop') || pathStr.includes('C--Users-huang-workspace')) {
          return {
            isDirectory: () => true,
          } as any;
        }
        return {
          isDirectory: () => false,
        } as any;
      });

      const projects = await store.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0]).toMatchObject({
        id: 'C--Users-huang-Desktop',
        name: 'Desktop',
        path: 'C:/Users/huang/Desktop',
      });
      expect(projects[1]).toMatchObject({
        id: 'C--Users-huang-workspace',
        name: 'workspace',
        path: 'C:/Users/huang/workspace',
      });
    });

    it('should handle empty projects directory', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const projects = await store.listProjects();

      expect(projects).toHaveLength(0);
    });

    it('should filter out projects whose decoded path no longer exists on disk', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        'C--Users-huang-Desktop' as any,
        'C--Users-huang-deleted' as any,
      ]);

      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);

      // 仅 Desktop 对应的真实目录仍存在
      const dirExists = (p: string) => p === 'C:/Users/huang/Desktop';
      const filteringStore = new SessionStore(mockProjectsDir, dirExists);

      const projects = await filteringStore.listProjects();

      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('C--Users-huang-Desktop');
    });
  });

  describe('listSessions', () => {
    it('should return sessions from JSONL files in project directory', async () => {
      const projectId = 'C--Users-huang-Desktop';

      vi.mocked(fs.readdir).mockResolvedValue([
        'session1.jsonl' as any,
        'session2.jsonl' as any,
        'readme.md' as any,
      ]);

      vi.mocked(fs.stat).mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes('session1')) {
          return {
            isFile: () => true,
            mtimeMs: 1000,
            birthtimeMs: 500,
          } as any;
        }
        if (pathStr.includes('session2')) {
          return {
            isFile: () => true,
            mtimeMs: 2000,
            birthtimeMs: 1500,
          } as any;
        }
        return { isFile: () => false } as any;
      });

      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pathStr = p.toString();
        if (pathStr.includes('session1')) {
          return '{"type":"user","message":{"content":"Hello"},"timestamp":"2026-06-11T17:45:31.574Z"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]},"timestamp":"2026-06-11T17:45:32.574Z"}';
        }
        if (pathStr.includes('session2')) {
          return '{"type":"user","message":{"content":"Question"},"timestamp":"2026-06-11T17:45:31.574Z"}';
        }
        return '';
      });

      const sessions = await store.listSessions(projectId);

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('session1');
      expect(sessions[0].title).toBe('Hello');
      expect(sessions[0].messageCount).toBe(2);
      expect(sessions[1].id).toBe('session2');
      expect(sessions[1].title).toBe('Question');
      expect(sessions[1].messageCount).toBe(1);
    });

    it('should handle project with no JSONL files', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['readme.md' as any]);
      vi.mocked(fs.stat).mockResolvedValue({ isFile: () => false } as any);

      const sessions = await store.listSessions('test-project');

      expect(sessions).toHaveLength(0);
    });
  });

  describe('getSession', () => {
    it('should return session detail with all messages', async () => {
      const projectId = 'C--Users-huang-Desktop';
      const sessionId = 'session1';

      vi.mocked(fs.readFile).mockResolvedValue(
        '{"type":"user","message":{"content":"Hello"},"timestamp":"2026-06-11T17:45:31.574Z"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]},"timestamp":"2026-06-11T17:45:32.574Z"}'
      );

      vi.mocked(fs.stat).mockResolvedValue({
        mtimeMs: 3000,
        birthtimeMs: 500,
      } as any);

      const session = await store.getSession(projectId, sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe('session1');
      expect(session?.projectId).toBe('C--Users-huang-Desktop');
      expect(session?.title).toBe('Hello');
      expect(session?.messages).toHaveLength(2);
      expect(session?.messages[0].content).toBe('Hello');
      expect(session?.messages[1].content).toBe('Hi');
    });

    it('should return null for non-existent session', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const session = await store.getSession('project', 'nonexistent');

      expect(session).toBeNull();
    });
  });

  describe('getSessionCwd', () => {
    it('should return cwd from the first jsonl line that has it', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        '{"type":"mode","mode":"normal"}\n{"type":"user","cwd":"C:\\\\Users\\\\huang\\\\workspace\\\\cc-web-develop","message":{"content":"hi"}}'
      );

      const cwd = await store.getSessionCwd('C--Users-huang-workspace-cc-web-develop', 's1');

      expect(cwd).toBe('C:\\Users\\huang\\workspace\\cc-web-develop');
    });

    it('should return null when no cwd present', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{"type":"mode","mode":"normal"}');

      const cwd = await store.getSessionCwd('p', 's');

      expect(cwd).toBeNull();
    });

    it('should return null when file unreadable', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const cwd = await store.getSessionCwd('p', 'nope');

      expect(cwd).toBeNull();
    });
  });

  describe('deleteSession (软删除)', () => {
    it('should soft-delete by renaming the jsonl to a .deleted file and return true', async () => {
      vi.mocked(fs.rename).mockResolvedValue(undefined as any);

      const result = await store.deleteSession('C--Users-huang-Desktop', 'session1');

      expect(result).toBe(true);
      // 软删除:改名为 .deleted 后缀,而非物理 unlink(文件内容保留可恢复)
      expect(fs.rename).toHaveBeenCalledWith(
        path.resolve(mockProjectsDir, 'C--Users-huang-Desktop', 'session1.jsonl'),
        path.resolve(mockProjectsDir, 'C--Users-huang-Desktop', 'session1.jsonl.deleted')
      );
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should return false when the session file does not exist', async () => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      vi.mocked(fs.rename).mockRejectedValue(err);

      const result = await store.deleteSession('C--Users-huang-Desktop', 'nope');

      expect(result).toBe(false);
    });

    it('should reject path traversal in sessionId and never rename', async () => {
      vi.mocked(fs.rename).mockResolvedValue(undefined as any);

      await expect(
        store.deleteSession('C--Users-huang-Desktop', '../../etc/passwd')
      ).rejects.toThrow(/traversal|invalid/i);

      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should reject path traversal in projectId and never rename', async () => {
      vi.mocked(fs.rename).mockResolvedValue(undefined as any);

      await expect(
        store.deleteSession('..', 'session1')
      ).rejects.toThrow(/traversal|invalid/i);

      expect(fs.rename).not.toHaveBeenCalled();
    });
  });

  describe('listSessions 不展示软删除的会话', () => {
    it('should not list sessions whose file was soft-deleted (.jsonl.deleted)', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        'alive.jsonl' as any,
        'gone.jsonl.deleted' as any,
      ]);

      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        mtimeMs: 1000,
        birthtimeMs: 500,
      } as any);

      vi.mocked(fs.readFile).mockResolvedValue(
        '{"type":"user","message":{"content":"Hello"},"timestamp":"2026-06-11T17:45:31.574Z"}'
      );

      const sessions = await store.listSessions('C--Users-huang-Desktop');

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('alive');
    });
  });
});
