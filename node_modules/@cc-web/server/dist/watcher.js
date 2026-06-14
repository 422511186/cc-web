import { readdir, stat } from 'fs';
import { basename, join } from 'path';
export class SessionWatcher {
    sseManager;
    watchers = new Map();
    intervals = new Map();
    constructor(sseManager) {
        this.sseManager = sseManager;
    }
    watchProject(projectId, projectPath) {
        if (this.watchers.has(projectId)) {
            return; // Already watching
        }
        console.log(`Setting up watcher for ${projectId} at ${projectPath}`);
        // Read initial state
        readdir(projectPath, (err, files) => {
            if (err) {
                console.error(`Failed to read directory ${projectPath}:`, err);
                return;
            }
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
            const watchedFiles = [];
            // Get initial mtimes
            let completed = 0;
            jsonlFiles.forEach(file => {
                const filepath = join(projectPath, file);
                stat(filepath, (err, stats) => {
                    completed++;
                    if (!err) {
                        watchedFiles.push({ path: filepath, mtime: stats.mtimeMs });
                    }
                    if (completed === jsonlFiles.length) {
                        this.watchers.set(projectId, watchedFiles);
                        console.log(`✓ Watching project: ${projectId} (${watchedFiles.length} files)`);
                        // Poll every second
                        const interval = setInterval(() => {
                            this.checkForChanges(projectId, projectPath);
                        }, 1000);
                        this.intervals.set(projectId, interval);
                    }
                });
            });
            if (jsonlFiles.length === 0) {
                this.watchers.set(projectId, []);
                console.log(`✓ Watching project: ${projectId} (0 files)`);
                const interval = setInterval(() => {
                    this.checkForChanges(projectId, projectPath);
                }, 1000);
                this.intervals.set(projectId, interval);
            }
        });
    }
    checkForChanges(projectId, projectPath) {
        const watchedFiles = this.watchers.get(projectId);
        if (!watchedFiles)
            return;
        readdir(projectPath, (err, files) => {
            if (err)
                return;
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
            jsonlFiles.forEach(file => {
                const filepath = join(projectPath, file);
                stat(filepath, (err, stats) => {
                    if (err)
                        return;
                    const existing = watchedFiles.find(w => w.path === filepath);
                    if (existing) {
                        // Check if modified
                        if (stats.mtimeMs > existing.mtime) {
                            existing.mtime = stats.mtimeMs;
                            const sessionId = basename(file, '.jsonl');
                            console.log(`✓ Session file changed: ${projectId}/${sessionId}`);
                            this.sseManager.notifySessionUpdate(projectId, sessionId);
                        }
                    }
                    else {
                        // New file
                        watchedFiles.push({ path: filepath, mtime: stats.mtimeMs });
                        const sessionId = basename(file, '.jsonl');
                        console.log(`✓ Session file added: ${projectId}/${sessionId}`);
                        this.sseManager.notifySessionUpdate(projectId, sessionId);
                    }
                });
            });
        });
    }
    unwatchProject(projectId) {
        const interval = this.intervals.get(projectId);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(projectId);
        }
        this.watchers.delete(projectId);
        console.log(`Stopped watching project: ${projectId}`);
    }
    async close() {
        for (const [projectId, interval] of this.intervals.entries()) {
            clearInterval(interval);
            console.log(`Stopped watching project: ${projectId}`);
        }
        this.intervals.clear();
        this.watchers.clear();
    }
}
//# sourceMappingURL=watcher.js.map