import { describe, it, expect } from "vitest";
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
});
