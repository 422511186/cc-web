import type { SSEManager } from './sse.js';
export declare class SessionWatcher {
    private sseManager;
    private watchers;
    private intervals;
    constructor(sseManager: SSEManager);
    watchProject(projectId: string, projectPath: string): void;
    private checkForChanges;
    unwatchProject(projectId: string): void;
    close(): Promise<void>;
}
//# sourceMappingURL=watcher.d.ts.map