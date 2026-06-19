import express, { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import type { SessionStore } from './store.js';
import { searchSessions } from './search.js';
import { SSEManager } from './sse.js';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export function createRouter(store: SessionStore, sseManager?: SSEManager, imageCacheDir?: string): Router {
  const router = Router();

  // GET /api/events - SSE endpoint (auth handled via query param since EventSource doesn't support headers)
  if (sseManager) {
    router.get('/events', (req, res) => {
      // Auth is already handled by middleware, just pass through
      sseManager.handleConnection(res);
    });
  }

  // GET /api/projects
  router.get('/projects', async (req, res) => {
    try {
      const projects = await store.listProjects();
      res.json({ projects });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  // GET /api/projects/:projectId/sessions
  router.get('/projects/:projectId/sessions', async (req, res) => {
    try {
      const { projectId } = req.params;
      const sessions = await store.listSessions(projectId);
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // DELETE /api/projects/:projectId/sessions/:sessionId - 删除一条历史会话
  router.delete('/projects/:projectId/sessions/:sessionId', async (req, res) => {
    try {
      const { projectId, sessionId } = req.params;
      const deleted = await store.deleteSession(projectId, sessionId);

      if (!deleted) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      // 路径穿越等非法请求按 400 处理
      res.status(400).json({ error: 'Failed to delete session' });
    }
  });

  // GET /api/sessions/:sessionId
  router.get('/sessions/:sessionId', async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { projectId } = req.query;

      if (!projectId || typeof projectId !== 'string') {
        next();
        return;
      }

      const session = await store.getSession(projectId, sessionId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  // GET /api/search
  router.get('/search', async (req, res) => {
    try {
      const { q } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({ error: 'q query parameter is required' });
        return;
      }

      const results = await searchSessions(store, q);
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: 'Failed to search' });
    }
  });

  // GET /api/image?path=<abs-path> - serve a pasted image from the image cache.
  // Access is constrained to imageCacheDir to prevent path traversal.
  router.get('/image', (req, res) => {
    const image = resolveImageRequest(imageCacheDir, req.query.path);
    if (!image.ok) {
      res.status(image.status).json({ error: image.error });
      return;
    }

    fs.stat(image.resolved, (err, stats) => {
      if (err || !stats.isFile()) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      fs.createReadStream(image.resolved).pipe(res);
    });
  });

  // GET /api/image-data?path=<abs-path> - JSON data URL variant for P2PTransport.
  router.get('/image-data', (req, res) => {
    const image = resolveImageRequest(imageCacheDir, req.query.path);
    if (!image.ok) {
      res.status(image.status).json({ error: image.error });
      return;
    }

    fs.readFile(image.resolved, (err, data) => {
      if (err) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      res.json({
        dataUrl: `data:${image.contentType};base64,${data.toString('base64')}`,
      });
    });
  });

  return router;
}

type ResolvedImageRequest =
  | { ok: true; resolved: string; contentType: string }
  | { ok: false; status: number; error: string };

function resolveImageRequest(imageCacheDir: string | undefined, requested: unknown): ResolvedImageRequest {
  if (!imageCacheDir) {
    return { ok: false, status: 404, error: 'Image serving not configured' };
  }

  if (!requested || typeof requested !== 'string') {
    return { ok: false, status: 400, error: 'path query parameter is required' };
  }

  const resolved = path.resolve(requested);
  const cacheRoot = path.resolve(imageCacheDir);
  const rel = path.relative(cacheRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPES[ext];
  if (!contentType) {
    return { ok: false, status: 415, error: 'Unsupported image type' };
  }

  return { ok: true, resolved, contentType };
}
