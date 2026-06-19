import express, { type Express } from "express";
import { mkdirSync, existsSync } from "node:fs";
import type { Config } from "./config.js";
import type { SessionStore } from "./store.js";
import type { SSEManager } from "./sse.js";
import { createAuthMiddleware } from "./auth.js";
import { createCspMiddleware } from "./csp.js";
import { createRouter } from "./routes.js";
import { realSdkClient, type SdkClient } from "./sdk.js";
import { SessionManager } from "./sessionManager.js";
import { createChatRouter } from "./chatRoutes.js";
import { createUploadRouter } from "./uploads.js";
import { createP2PRouter, type HostP2PRuntimeApi } from "./p2pRoutes.js";

/**
 * 组装 Express 应用:鉴权前置,然后挂载浏览路由(计划一)与续聊/上传路由(计划二)。
 * sdkClient 可注入,测试传 fake 以免真起 claude。
 */
export function createApp(
  config: Config,
  store: SessionStore,
  sseManager?: SSEManager,
  sdkClient: SdkClient = realSdkClient,
  p2pRuntime?: HostP2PRuntimeApi
): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // CSP 安全策略（全局，先于鉴权）
  app.use(createCspMiddleware());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "coderelay-host" });
  });

  // 鉴权前置于所有 /api 路由
  app.use("/api", createAuthMiddleware(config.authToken));

  // 浏览路由(projects / sessions / search / image / events)
  app.use("/api", createP2PRouter(p2pRuntime));
  app.use("/api", createRouter(store, sseManager, config.imageCacheDir));

  // 续聊 + 上传
  mkdirSync(config.uploadsDir, { recursive: true });
  const manager = new SessionManager({
    client: sdkClient,
    permissionMode: config.permissionMode,
    maxConcurrent: config.maxConcurrent,
    idleTimeoutMs: config.idleTimeoutMs,
    heartbeatTtlMs: config.heartbeatTtlMs,
    orphanIdleTimeoutMs: config.orphanIdleTimeoutMs,
    cwd: config.claudeProjectsDir,
  });
  // 续聊时按 session 真实项目目录定位 resume,目录已删则前置拦截
  app.use(
    "/api",
    createChatRouter(
      manager,
      (projectId, sessionId) =>
        projectId ? store.getSessionCwd(projectId, sessionId) : Promise.resolve(null),
      (cwd) => existsSync(cwd),
      config.uploadsDir
    )
  );
  app.use("/api/uploads", createUploadRouter(config.uploadsDir));

  return app;
}
