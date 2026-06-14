import fs from 'node:fs/promises';
import path from 'node:path';
import { parseJsonl } from './jsonl.js';
import { extractTitle } from './title.js';
export class SessionStore {
    projectsDir;
    constructor(projectsDir) {
        this.projectsDir = projectsDir;
    }
    async listProjects() {
        try {
            const entries = await fs.readdir(this.projectsDir);
            const projects = [];
            for (const entry of entries) {
                if (entry.startsWith('.'))
                    continue;
                const fullPath = path.join(this.projectsDir, entry);
                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        projects.push({
                            id: entry,
                            name: this.decodeProjectName(entry),
                            path: this.decodeProjectPath(entry),
                        });
                    }
                }
                catch {
                    // Skip entries that can't be stat'd
                    continue;
                }
            }
            return projects;
        }
        catch {
            return [];
        }
    }
    async listSessions(projectId) {
        try {
            const projectPath = path.join(this.projectsDir, projectId);
            const entries = await fs.readdir(projectPath);
            const sessions = [];
            for (const entry of entries) {
                if (!entry.endsWith('.jsonl'))
                    continue;
                const fullPath = path.join(projectPath, entry);
                try {
                    const stat = await fs.stat(fullPath);
                    if (!stat.isFile())
                        continue;
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
                }
                catch {
                    // Skip files that can't be read
                    continue;
                }
            }
            return sessions;
        }
        catch {
            return [];
        }
    }
    async getSession(projectId, sessionId) {
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
        }
        catch {
            return null;
        }
    }
    decodeProjectName(encoded) {
        // Extract last segment from path
        // C--Users-huang-Desktop -> Desktop
        const segments = encoded.split('-').filter(s => s);
        return segments[segments.length - 1] || encoded;
    }
    decodeProjectPath(encoded) {
        // C--Users-huang-Desktop -> C:/Users/huang/Desktop
        return encoded.replace(/--/g, ':/').replace(/-/g, '/');
    }
}
//# sourceMappingURL=store.js.map