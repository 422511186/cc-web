import express from 'express';
import { loadConfig } from './config.js';
import { SessionStore } from './store.js';
import { createAuthMiddleware } from './auth.js';
import { createRouter } from './routes.js';
async function main() {
    const config = loadConfig();
    const store = new SessionStore(config.claudeProjectsDir);
    const app = express();
    // Middleware
    app.use(express.json());
    // Auth middleware for all /api routes
    app.use('/api', createAuthMiddleware(config.authToken));
    // API routes
    app.use('/api', createRouter(store));
    // Start server
    app.listen(config.port, () => {
        console.log(`Server listening on port ${config.port}`);
        console.log(`Projects directory: ${config.claudeProjectsDir}`);
        console.log(`Permission mode: ${config.permissionMode}`);
    });
}
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map