import type { Request, Response, NextFunction } from 'express';

export function createCspMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const isHostManagementPage = req.path === '/host' || req.path === '/host/';
    const directives = [
      "default-src 'self'",
      isHostManagementPage ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
      isHostManagementPage ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
      "img-src 'self' data:",
      "object-src 'none'",
    ];
    if (!isHostManagementPage) {
      directives.push("upgrade-insecure-requests");
    }

    res.setHeader('Content-Security-Policy', directives.join('; '));
    next();
  };
}
