import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import type { SessionStore } from "./store.js";
import type { SdkClient } from "./sdk.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** idle fake SDK:永不结束,避免测试里真起 claude */
const idleClient: SdkClient = {
  start: async function* () {
    await new Promise(() => {});
    yield {} as SDKMessage;
  },
};

function baseConfig(): Config {
  return {
    authToken: "secret",
    port: 3000,
    claudeProjectsDir: "/tmp/projects",
    imageCacheDir: "/tmp/image-cache",
    permissionMode: "default",
    idleTimeoutMs: 60_000,
    maxConcurrent: 4,
    uploadsDir: mkdtempSync(join(tmpdir(), "cc-web-app-")),
  };
}

function mockStore(): SessionStore {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
  } as unknown as SessionStore;
}

describe("createApp", () => {
  it("exposes an unauthenticated health check for local E2E readiness", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const res = await request(app).get("/healthz");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, service: "coderelay-host" });
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });

  it("sets CSP header on all responses", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const res = await request(app)
        .get("/api/projects")
        .set("Authorization", `Bearer ${cfg.authToken}`);

      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });

  it("chat routes require auth", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const res = await request(app).post("/api/sessions/new").send({});
      expect(res.status).toBe(401);
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });

  it("chat routes reachable with valid token", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const res = await request(app)
        .post("/api/sessions/new")
        .set("Authorization", `Bearer ${cfg.authToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect(typeof res.body.runId).toBe("string");
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });

  it("browse routes still work with valid token", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const res = await request(app)
        .get("/api/projects")
        .set("Authorization", `Bearer ${cfg.authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.projects).toEqual([]);
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });

  it("active agent probe routes should not be intercepted by history session route", async () => {
    const cfg = baseConfig();
    const app = createApp(cfg, mockStore(), undefined, idleClient);
    try {
      const startRes = await request(app)
        .post("/api/sessions/new")
        .set("Authorization", `Bearer ${cfg.authToken}`)
        .send({});
      const runId = startRes.body.runId as string;

      const activeListRes = await request(app)
        .get("/api/sessions/active")
        .set("Authorization", `Bearer ${cfg.authToken}`);
      expect(activeListRes.status).toBe(200);
      expect(activeListRes.body.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ runId }),
        ])
      );

      const probeRes = await request(app)
        .get(`/api/sessions/${runId}`)
        .set("Authorization", `Bearer ${cfg.authToken}`);
      expect(probeRes.status).toBe(200);
      expect(probeRes.body).toEqual({ runId, active: true });
    } finally {
      rmSync(cfg.uploadsDir, { recursive: true, force: true });
    }
  });
});
