import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from './auth.js';
import type { Request, Response, NextFunction } from 'express';

describe('createAuthMiddleware', () => {
  const createMockReq = (authHeader?: string): Partial<Request> => ({
    headers: authHeader ? { authorization: authHeader } : {},
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

  it('should return 401 when no authorization header', () => {
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

  it('should handle authorization header without Bearer prefix', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('secret-token');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when Bearer prefix is present but token is wrong', () => {
    const middleware = createAuthMiddleware('secret-token');
    const req = createMockReq('Bearer ');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
