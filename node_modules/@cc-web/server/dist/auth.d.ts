import type { Request, Response, NextFunction } from 'express';
export declare function createAuthMiddleware(expectedToken: string): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map