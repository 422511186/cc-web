import { Router } from 'express';
import type { SessionStore } from './store.js';
import { SSEManager } from './sse.js';
export declare function createRouter(store: SessionStore, sseManager?: SSEManager, imageCacheDir?: string): Router;
//# sourceMappingURL=routes.d.ts.map