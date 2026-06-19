import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRouter } from './routes.js';
import type { SessionStore } from './store.js';
import { SSEManager } from './sse.js';

describe('API Routes', () => {
  let app: express.Application;
  let mockStore: SessionStore;
  let sseManager: SSEManager;

  beforeEach(() => {
    mockStore = {
      listProjects: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
      deleteSession: vi.fn(),
    } as any;

    sseManager = new SSEManager(mockStore);

    app = express();
    app.use(express.json());
    app.use('/api', createRouter(mockStore, sseManager));
  });

  describe('GET /api/projects', () => {
    it('should return list of projects', async () => {
      vi.mocked(mockStore.listProjects).mockResolvedValue([
        { id: 'project1', name: 'Project 1', path: '/path1' },
        { id: 'project2', name: 'Project 2', path: '/path2' },
      ]);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(2);
      expect(res.body.projects[0].id).toBe('project1');
    });

    it('should return empty array when no projects', async () => {
      vi.mocked(mockStore.listProjects).mockResolvedValue([]);

      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(0);
    });
  });

  describe('GET /api/projects/:projectId/sessions', () => {
    it('should return list of sessions for a project', async () => {
      vi.mocked(mockStore.listSessions).mockResolvedValue([
        {
          id: 'session1',
          projectId: 'project1',
          title: 'Session 1',
          createdAt: 1000,
          updatedAt: 2000,
          messageCount: 5,
        },
      ]);

      const res = await request(app).get('/api/projects/project1/sessions');

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].id).toBe('session1');
    });
  });

  describe('GET /api/sessions/:sessionId', () => {
    it('should return session detail with messages', async () => {
      vi.mocked(mockStore.getSession).mockResolvedValue({
        id: 'session1',
        projectId: 'project1',
        title: 'Test Session',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 2,
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'Hi', timestamp: 2000 },
        ],
      });

      const res = await request(app)
        .get('/api/sessions/session1')
        .query({ projectId: 'project1' });

      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe('session1');
      expect(res.body.session.messages).toHaveLength(2);
    });

    it('should return 404 when session not found', async () => {
      vi.mocked(mockStore.getSession).mockResolvedValue(null);

      const res = await request(app)
        .get('/api/sessions/nonexistent')
        .query({ projectId: 'project1' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('should pass through when projectId missing so live session routes can handle it', async () => {
      const passThroughApp = express();
      passThroughApp.use('/api', createRouter(mockStore, sseManager));
      passThroughApp.get('/api/sessions/:runId', (req, res) => {
        res.json({ runId: req.params.runId, liveRoute: true });
      });

      const res = await request(passThroughApp).get('/api/sessions/session1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ runId: 'session1', liveRoute: true });
      expect(mockStore.getSession).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/projects/:projectId/sessions/:sessionId', () => {
    it('should delete the session and return ok', async () => {
      vi.mocked(mockStore.deleteSession).mockResolvedValue(true);

      const res = await request(app).delete(
        '/api/projects/project1/sessions/session1'
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockStore.deleteSession).toHaveBeenCalledWith('project1', 'session1');
    });

    it('should return 404 when the session does not exist', async () => {
      vi.mocked(mockStore.deleteSession).mockResolvedValue(false);

      const res = await request(app).delete(
        '/api/projects/project1/sessions/nope'
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('should return 400 when the path is rejected (traversal)', async () => {
      vi.mocked(mockStore.deleteSession).mockRejectedValue(
        new Error('Invalid session path: path traversal detected')
      );

      const res = await request(app).delete(
        '/api/projects/project1/sessions/whatever'
      );

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/search', () => {
    it('should return search results', async () => {
      vi.mocked(mockStore.listProjects).mockResolvedValue([
        { id: 'project1', name: 'Project 1', path: '/path1' },
      ]);

      vi.mocked(mockStore.listSessions).mockResolvedValue([
        {
          id: 'session1',
          projectId: 'project1',
          title: 'Test',
          createdAt: 1000,
          updatedAt: 2000,
          messageCount: 1,
        },
      ]);

      vi.mocked(mockStore.getSession).mockResolvedValue({
        id: 'session1',
        projectId: 'project1',
        title: 'Test',
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
        messages: [
          { role: 'user', content: 'How do I fix the bug?', timestamp: 1000 },
        ],
      });

      const res = await request(app).get('/api/search').query({ q: 'bug' });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].sessionId).toBe('session1');
    });

    it('should return 400 when query parameter missing', async () => {
      const res = await request(app).get('/api/search');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('q query parameter is required');
    });
  });

  describe('GET /api/image', () => {
    let imageDir: string;
    let imageApp: express.Application;
    let pngPath: string;

    beforeEach(() => {
      imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-img-'));
      pngPath = path.join(imageDir, 'shot.png');
      // 1x1 transparent PNG
      fs.writeFileSync(pngPath, Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ));

      imageApp = express();
      imageApp.use('/api', createRouter(mockStore, sseManager, imageDir));
    });

    afterEach(() => {
      fs.rmSync(imageDir, { recursive: true, force: true });
    });

    it('should serve an image within the cache dir', async () => {
      const res = await request(imageApp).get('/api/image').query({ path: pngPath });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should expose an image data URL for transport-backed clients', async () => {
      const res = await request(imageApp).get('/api/image-data').query({ path: pngPath });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      });
    });

    it('should reject paths outside the cache dir (traversal)', async () => {
      const outside = path.join(imageDir, '..', '..', 'secret.png');
      const res = await request(imageApp).get('/api/image').query({ path: outside });

      expect(res.status).toBe(403);
    });

    it('should return 404 for a missing file', async () => {
      const res = await request(imageApp)
        .get('/api/image')
        .query({ path: path.join(imageDir, 'nope.png') });

      expect(res.status).toBe(404);
    });

    it('should reject unsupported extensions', async () => {
      const txt = path.join(imageDir, 'note.txt');
      fs.writeFileSync(txt, 'hi');
      const res = await request(imageApp).get('/api/image').query({ path: txt });

      expect(res.status).toBe(415);
    });

    it('should return 400 when path param missing', async () => {
      const res = await request(imageApp).get('/api/image');

      expect(res.status).toBe(400);
    });

    it('should return 404 when image serving is not configured', async () => {
      const res = await request(app).get('/api/image').query({ path: pngPath });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/events', () => {
    it('should return SSE stream with correct headers', (done) => {
      request(app)
        .get('/api/events')
        .set('Accept', 'text/event-stream')
        .end((err, res) => {
          if (err) return done(err);

          expect(res.status).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          expect(res.headers['cache-control']).toBe('no-cache');
          expect(res.headers['connection']).toBe('keep-alive');

          sseManager.close();
          done();
        });
    });
  });
});
