import express, { Router } from 'express';
import type { SessionStore } from './store.js';
import { searchSessions } from './search.js';

export function createRouter(store: SessionStore): Router {
  const router = Router();

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

  // GET /api/sessions/:sessionId
  router.get('/sessions/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { projectId } = req.query;

      if (!projectId || typeof projectId !== 'string') {
        res.status(400).json({ error: 'projectId query parameter is required' });
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

  return router;
}
