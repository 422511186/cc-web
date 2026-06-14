import express from 'express';
import { join } from 'path';
import { loadConfig } from './config.js';
import { SessionStore } from './store.js';
import { createAuthMiddleware } from './auth.js';
import { createRouter } from './routes.js';
import { SSEManager } from './sse.js';
import { SessionWatcher } from './watcher.js';

async function main() {
  const config = loadConfig();
  const store = new SessionStore(config.claudeProjectsDir);
  const sseManager = new SSEManager(store);
  const watcher = new SessionWatcher(sseManager);

  // Watch all projects - use the .claude/projects/PROJECT_ID path where JSONL files live
  const projects = await store.listProjects();
  for (const project of projects) {
    const projectStoragePath = join(config.claudeProjectsDir, project.id);
    watcher.watchProject(project.id, projectStoragePath);
  }

  const app = express();

  // Middleware
  app.use(express.json());

  // Auth middleware for all /api routes
  app.use('/api', createAuthMiddleware(config.authToken));

  // API routes
  app.use('/api', createRouter(store, sseManager, config.imageCacheDir));

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
    console.log(`Projects directory: ${config.claudeProjectsDir}`);
    console.log(`Permission mode: ${config.permissionMode}`);
    console.log(`Watching ${projects.length} projects for changes`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    await watcher.close();
    sseManager.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
