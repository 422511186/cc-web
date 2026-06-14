export function createAuthMiddleware(expectedToken) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const queryToken = req.query.token;
        // Try header first, then query parameter
        let token;
        if (authHeader) {
            // Support both "Bearer token" and plain "token" formats
            token = authHeader.startsWith('Bearer ')
                ? authHeader.slice(7)
                : authHeader;
        }
        else if (queryToken) {
            token = queryToken;
        }
        if (!token || token !== expectedToken) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map