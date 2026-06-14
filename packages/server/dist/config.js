import os from 'node:os';
import path from 'node:path';
export function loadConfig() {
    const authToken = process.env.AUTH_TOKEN || '';
    const port = parseInt(process.env.PORT || '3000', 10) || 3000;
    const claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR ||
        path.join(os.homedir(), '.claude', 'projects');
    // Pasted images live in ~/.claude/image-cache (sibling of the projects dir).
    const imageCacheDir = process.env.CLAUDE_IMAGE_CACHE_DIR ||
        path.join(path.dirname(claudeProjectsDir), 'image-cache');
    const permissionMode = process.env.PERMISSION_MODE || 'default';
    if (!authToken) {
        throw new Error('AUTH_TOKEN environment variable is required');
    }
    return {
        authToken,
        port,
        claudeProjectsDir,
        imageCacheDir,
        permissionMode,
    };
}
//# sourceMappingURL=config.js.map