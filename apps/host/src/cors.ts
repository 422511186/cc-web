import type { RequestHandler } from "express";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "authorization,content-type";

export function createCorsMiddleware(allowedOrigins: readonly string[] = []): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    const origin = req.header("Origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    }

    if (req.method === "OPTIONS" && req.header("Access-Control-Request-Method")) {
      res.status(204).end();
      return;
    }

    next();
  };
}
