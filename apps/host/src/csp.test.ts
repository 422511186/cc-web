import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createCspMiddleware } from './csp.js';

describe('CSP Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {};
    mockRes = {
      setHeader: vi.fn(),
    };
    mockNext = vi.fn();
  });

  it('should set Content-Security-Policy header with default directives', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("default-src 'self'")
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('should block inline scripts by default', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    // Should NOT contain 'unsafe-inline' for script-src
    expect(cspHeader).toMatch(/script-src[^;]*(?!'unsafe-inline')/);
  });

  it('should block eval() by default', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    // Should NOT contain 'unsafe-eval' for script-src
    expect(cspHeader).not.toContain("'unsafe-eval'");
  });

  it('should allow specific image sources including data: URIs', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    expect(cspHeader).toMatch(/img-src[^;]*'self'/);
    expect(cspHeader).toMatch(/img-src[^;]*data:/);
  });

  it('should allow styles from self', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    expect(cspHeader).toMatch(/style-src[^;]*'self'/);
  });

  it('should set upgrade-insecure-requests directive', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    expect(cspHeader).toContain('upgrade-insecure-requests');
  });

  it('should block object and embed by default', () => {
    const middleware = createCspMiddleware();

    middleware(mockReq as Request, mockRes as Response, mockNext);

    const cspHeader = (mockRes.setHeader as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;

    expect(cspHeader).toMatch(/object-src[^;]*'none'/);
  });
});
