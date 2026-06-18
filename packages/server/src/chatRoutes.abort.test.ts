import { describe, test, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createChatRouter } from './chatRoutes.js';
import type { SessionManager } from './sessionManager.js';

describe('Chat routes - abort', () => {
  let app: express.Application;
  let mockManager: SessionManager;

  beforeEach(() => {
    mockManager = {
      get: vi.fn(),
      abort: vi.fn(),
    } as unknown as SessionManager;

    app = express();
    app.use(express.json());
    const router = createChatRouter(mockManager);
    app.use('/api', router);
  });

  test('POST /sessions/:runId/abort 调用 manager.abort 并返回成功', async () => {
    const mockSession = { id: 'run-123' };
    vi.mocked(mockManager.get).mockReturnValue(mockSession as any);

    const res = await request(app)
      .post('/api/sessions/run-123/abort')
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockManager.abort).toHaveBeenCalledWith('run-123');
  });

  test('POST /sessions/:runId/abort 会话不存在时返回 404', async () => {
    vi.mocked(mockManager.get).mockReturnValue(null);

    const res = await request(app)
      .post('/api/sessions/run-123/abort')
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session not found');
    expect(mockManager.abort).not.toHaveBeenCalled();
  });
});
