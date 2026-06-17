import type { Request, Response, NextFunction } from 'express';

export function createCspMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const directives = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ];

    res.setHeader('Content-Security-Policy', directives.join('; '));
    next();
  };
}
