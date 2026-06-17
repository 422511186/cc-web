import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function createAuthMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const allowsQueryToken =
      req.method === "GET" &&
      (req.path === "/events" ||
        req.path === "/image" ||
        req.path.endsWith("/stream"));

    // Try header first, then query parameter
    let token: string | undefined;

    if (authHeader) {
      // 仅接受标准 Bearer 头，避免误把其它 Authorization 方案当作 token。
      if (!authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      token = authHeader.slice(7);
    } else if (queryToken && allowsQueryToken) {
      token = queryToken;
    }

    // Use constant-time comparison to prevent timing attacks
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tokenBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expectedToken);

    // timingSafeEqual requires same length buffers
    if (tokenBuffer.length !== expectedBuffer.length) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!timingSafeEqual(tokenBuffer, expectedBuffer)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}
