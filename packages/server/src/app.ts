import express, { type Express } from "express";
import { mkdirSync } from "node:fs";
import type { Config } from "./config.js";
import type { SessionStore } from "./store.js";
import type { SSEManager } from "./sse.js";
import { createAuthMiddleware } from "./auth.js";
import { createRouter } from "./routes.js";
import { realSdkClient, type SdkClient } from "./sdk.js";
import { SessionManager } from "./sessionManager.js";
import { createChatRouter } from "./chatRoutes.js";
import { createUploadRouter } from "./uploads.js";

/**
 * 组装 Express 应用:鉴权前置,然后挂载浏览路由(计划一)与续聊/上传路由(计划二)。
 * sdkClient 可注入,测试传 fake 以免真起 claude。
 */
export function createApp(
  config: Config,
  store: SessionStore,
  sseManager?: SSEManager,
  sdkClient: SdkClient = realSdkClient
): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // 鉴权前置于所有 /api 路由
  app.use("/api", createAuthMiddleware(config.authToken));

  // 浏览路由(projects / sessions / search / image / events)
  app.use("/api", createRouter(store, sseManager, config.imageCacheDir));

  // 续聊 + 上传
  mkdirSync(config.uploadsDir, { recursive: true });
  const manager = new SessionManager({
    client: sdkClient,
    permissionMode: config.permissionMode,
    maxConcurrent: config.maxConcurrent,
    idleTimeoutMs: config.idleTimeoutMs,
    cwd: config.claudeProjectsDir,
  });
  app.use("/api", createChatRouter(manager));
  app.use("/api/uploads", createUploadRouter(config.uploadsDir));

  return app;
}
