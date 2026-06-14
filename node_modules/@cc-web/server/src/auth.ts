import type { Request, Response, NextFunction } from 'express';

export function createAuthMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Support both "Bearer token" and plain "token" formats
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (token !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
