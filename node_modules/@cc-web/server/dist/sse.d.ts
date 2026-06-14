import type { Response } from 'express';
import type { SessionStore } from './store.js';
export declare class SSEManager {
    private store;
    private clients;
    private nextClientId;
    private pingInterval;
    constructor(store: SessionStore);
    handleConnection(res: Response): void;
    notifySessionUpdate(projectId: string, sessionId: string): void;
    getClientCount(): number;
    close(): void;
    private sendToAll;
}
//# sourceMappingURL=sse.d.ts.map