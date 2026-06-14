import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from './auth.js';
describe('createAuthMiddleware', () => {
    const createMockReq = (authHeader) => ({
        headers: authHeader ? { authorization: authHeader } : {},
    });
    const createMockRes = () => {
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
        return res;
    };
    let mockNext;
    beforeEach(() => {
        mockNext = vi.fn();
    });
    it('should call next() when valid token is provided', () => {
        const middleware = createAuthMiddleware('secret-token');
        const req = createMockReq('Bearer secret-token');
        const res = createMockRes();
        middleware(req, res, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    it('should return 401 when no authorization header', () => {
        const middleware = createAuthMiddleware('secret-token');
        const req = createMockReq();
        const res = createMockRes();
        middleware(req, res, mockNext);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(mockNext).not.toHaveBeenCalled();
    });
    it('should return 401 when token does not match', () => {
        const middleware = createAuthMiddleware('secret-token');
        const req = createMockReq('Bearer wrong-token');
        const res = createMockRes();
        middleware(req, res, mockNext);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(mockNext).not.toHaveBeenCalled();
    });
    it('should handle authorization header without Bearer prefix', () => {
        const middleware = createAuthMiddleware('secret-token');
        const req = createMockReq('secret-token');
        const res = createMockRes();
        middleware(req, res, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    it('should return 401 when Bearer prefix is present but token is wrong', () => {
        const middleware = createAuthMiddleware('secret-token');
        const req = createMockReq('Bearer ');
        const res = createMockRes();
        middleware(req, res, mockNext);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=auth.test.js.map