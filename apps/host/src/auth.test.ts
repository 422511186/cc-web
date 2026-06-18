import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import type { Request, Response, NextFunction } from 'express';

describe('createAuthMiddleware', () => {
  const createMockReq = (
    authHeader?: string,
    queryToken?: string,
    path = '/projects',
    method = 'GET'
  ): Partial<Request> => ({
    headers: authHeader ? { authorization: authHeader } : {},
    query: queryToken ? { token: queryToken } : {},
    path,
    method,
  });

  const createMockRes = (): Partial<Response> => {
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  };

  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  it('should call next() when valid token is provided', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('Bearer secret-token');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should accept token from query parameter for SSE/image/stream endpoints', () => {
    const middleware = createAuthMiddleware('secret-token');
    const allowedRequests = [
      createMockReq(undefined, 'secret-token', '/events'),
      createMockReq(undefined, 'secret-token', '/image'),
      createMockReq(undefined, 'secret-token', '/sessions/run-1/stream'),
    ];

    allowedRequests.forEach((req) => {
      const res = createMockRes();
      middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      vi.clearAllMocks();
    });
  });

  it('should reject query token on non-stream API endpoints', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq(undefined, 'secret-token', '/projects');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should prioritize header token over query token', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('Bearer secret-token', 'wrong-token');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when no authorization header or query token', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq();
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when token does not match', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('Bearer wrong-token');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject authorization header without Bearer prefix', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('secret-token');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject malformed authorization header even if query token is valid', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('secret-token', 'secret-token', '/events');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when Bearer prefix is present but token is wrong', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('Bearer ');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject tokens of different lengths', () => {
    const middleware = createAuthMiddleware('secret-token-1234567890');
    const req = createMockReq('Bearer short');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should reject tokens that differ at any position', () => {
    const middleware = createAuthMiddleware('secret-token-1234567890');

    // Test with tokens that differ at different positions (same length)
    const wrongTokens = [
      'Xecret-token-1234567890', // differs at first char
      'secret-Xoken-1234567890', // differs in middle
      'secret-token-123456789X', // differs at last char
    ];

    wrongTokens.forEach(wrongToken => {
      const req = createMockReq(`Bearer ${wrongToken}`);
      const res = createMockRes();

      middleware(req as Request, res as Response, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
