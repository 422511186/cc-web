import os from 'node:os';
import path from 'node:path';
export function loadConfig() {
    const authToken = process.env.AUTH_TOKEN || '';
    const port = parseInt(process.env.PORT || '3000', 10) || 3000;
    const claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR ||
        path.join(os.homedir(), '.claude', 'projects');
    const permissionMode = process.env.PERMISSION_MODE || 'default';
    if (!authToken) {
        throw new Error('AUTH_TOKEN environment variable is required');
    }
    return {
        authToken,
        port,
        claudeProjectsDir,
        permissionMode,
    };
}
//# sourceMappingURL=config.js.map