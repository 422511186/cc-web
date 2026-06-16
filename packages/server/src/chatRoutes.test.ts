import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createChatRouter } from "./chatRoutes.js";
import { SessionManager } from "./sessionManager.js";
import type { SdkClient } from "./sdk.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** fake SDK:收到第一条用户消息后回一句话并结束一轮 */
const echoClient: SdkClient = {
  start: async function* (params) {
    for await (const _msg of params.prompt) {
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          model: "m",
          content: [{ type: "text", text: "pong" }],
        },
        parent_tool_use_id: null,
        uuid: "u1",
        session_id: "s1",
      } as unknown as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "pong",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
      break;
    }
  },
};

function app() {
  const mgr = new SessionManager({
    client: echoClient,
    permissionMode: "default",
    maxConcurrent: 4,
    idleTimeoutMs: 60_000,
  });
  const a = express();
  a.use(express.json());
  a.use("/api", createChatRouter(mgr));
  return a;
}

describe("chat routes", () => {
  it("POST /sessions/new returns a runId", async () => {
    const res = await request(app()).post("/api/sessions/new").send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.runId).toBe("string");
  });

  it("POST /sessions/:runId/message on unknown runId is 404", async () => {
    const res = await request(app())
      .post("/api/sessions/ghost/message")
      .send({ text: "hi" });
    expect(res.status).toBe(404);
  });

  it("续聊时原项目目录已不存在,返回 409 友好错误且不启动会话", async () => {
    const mgr = new SessionManager({
      client: echoClient,
      permissionMode: "default",
      maxConcurrent: 4,
      idleTimeoutMs: 60_000,
    });
    const spy = vi.spyOn(mgr, "startContinue");
    const a = express();
    a.use(express.json());
    a.use(
      "/api",
      createChatRouter(
        mgr,
        async () => "C:/deleted/project",
        (cwd) => cwd !== "C:/deleted/project" // 该目录视为不存在
      )
    );

    const res = await request(a)
      .post("/api/sessions/sess-x/continue")
      .send({ projectId: "proj-x" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/目录/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DELETE /sessions/:runId 释放会话(忙碌保活/空闲回收,不中断后台执行)并返回 ok", async () => {
    const mgr = new SessionManager({
      client: echoClient,
      permissionMode: "default",
      maxConcurrent: 4,
      idleTimeoutMs: 60_000,
    });
    const releaseSpy = vi.spyOn(mgr, "release");
    const closeSpy = vi.spyOn(mgr, "close");
    const a = express();
    a.use(express.json());
    a.use("/api", createChatRouter(mgr));

    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const res = await request(a).delete(`/api/sessions/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(releaseSpy).toHaveBeenCalledWith(runId);
    // 不应以强制 abort 语义关闭(runToCompletion 结束后的 "exited" 兜底无害)
    const abortCalls = closeSpy.mock.calls.filter(([, reason]) => reason === "aborted");
    expect(abortCalls).toHaveLength(0);
  });

  it("DELETE /sessions/:runId 对未知 runId 也返回 ok(幂等)", async () => {
    const res = await request(app()).delete("/api/sessions/ghost");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("streams assistant output over SSE after a message", async () => {
    const a = app();
    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId;

    // 先发消息(echoClient 会在收到消息后产出 pong)
    await request(a).post(`/api/sessions/${runId}/message`).send({ text: "ping" });

    // 读 SSE 流,直到拿到 turn_end
    const res = await request(a)
      .get(`/api/sessions/${runId}/stream`)
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c.toString();
          if (data.includes(`"type":"turn_end"`)) {
            (res as unknown as { destroy: () => void }).destroy();
          }
        });
        res.on("close", () => cb(null, data));
        res.on("end", () => cb(null, data));
      });

    const body = (res.text ?? (res.body as string)) as string;
    expect(body).toContain(`"type":"block"`);
    expect(body).toContain(`"type":"turn_end"`);
  });

  it("重连(再次订阅)整段重放全量事件日志,而非只给断开期间的增量", async () => {
    const a = app();
    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId;

    await request(a).post(`/api/sessions/${runId}/message`).send({ text: "ping" });

    // 读到 turn_end 的工具函数
    const drainUntilTurnEnd = () =>
      request(a)
        .get(`/api/sessions/${runId}/stream`)
        .buffer(true)
        .parse((res, cb) => {
          let data = "";
          res.on("data", (c: Buffer) => {
            data += c.toString();
            if (data.includes(`"type":"turn_end"`)) {
              (res as unknown as { destroy: () => void }).destroy();
            }
          });
          res.on("close", () => cb(null, data));
          res.on("end", () => cb(null, data));
        });

    // 第一次订阅:消费掉 block + turn_end
    const first = await drainUntilTurnEnd();
    const firstBody = (first.text ?? (first.body as string)) as string;
    expect(firstBody).toContain(`"type":"turn_end"`);

    // 第二次订阅(模拟切走再切回):应再次拿到全量的 block + turn_end
    const second = await drainUntilTurnEnd();
    const secondBody = (second.text ?? (second.body as string)) as string;
    expect(secondBody).toContain(`"type":"block"`);
    expect(secondBody).toContain(`"type":"turn_end"`);
  });

  describe("POST /sessions/new with cwd", () => {
    it("请求体带合法 cwd(存在的目录)→ 200 返回 runId,且 sessionManager.startNew 被调用时传入该 cwd", async () => {
      const mgr = new SessionManager({
        client: echoClient,
        permissionMode: "default",
        maxConcurrent: 4,
        idleTimeoutMs: 60_000,
      });
      const spy = vi.spyOn(mgr, "startNew");
      const a = express();
      a.use(express.json());
      a.use(
        "/api",
        createChatRouter(
          mgr,
          undefined,
          (cwd) => cwd === "C:/valid/project" // 只有这个目录存在
        )
      );

      const res = await request(a)
        .post("/api/sessions/new")
        .send({ cwd: "C:/valid/project" });

      expect(res.status).toBe(200);
      expect(typeof res.body.runId).toBe("string");
      expect(spy).toHaveBeenCalledWith(expect.anything(), "C:/valid/project");
    });

    it("请求体带不存在的 cwd → 400 返回错误'目录不存在'", async () => {
      const mgr = new SessionManager({
        client: echoClient,
        permissionMode: "default",
        maxConcurrent: 4,
        idleTimeoutMs: 60_000,
      });
      const a = express();
      a.use(express.json());
      a.use(
        "/api",
        createChatRouter(
          mgr,
          undefined,
          (cwd) => cwd !== "C:/nonexistent" // 这个目录不存在
        )
      );

      const res = await request(a)
        .post("/api/sessions/new")
        .send({ cwd: "C:/nonexistent" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/目录不存在/);
    });

    it("请求体带穿越/非法 cwd(../)→ 400 返回'非法路径'", async () => {
      const mgr = new SessionManager({
        client: echoClient,
        permissionMode: "default",
        maxConcurrent: 4,
        idleTimeoutMs: 60_000,
      });
      const a = express();
      a.use(express.json());
      a.use("/api", createChatRouter(mgr));

      const res = await request(a)
        .post("/api/sessions/new")
        .send({ cwd: "../etc/passwd" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/非法路径/);
    });
  });
});
