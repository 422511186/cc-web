import type { Request, Response, NextFunction } from 'express';

export function createAuthMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;

    // Try header first, then query parameter
    let token: string | undefined;

    if (authHeader) {
      // Support both "Bearer token" and plain "token" formats
      token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token || token !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
