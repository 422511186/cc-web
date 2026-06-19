import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
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

/** long-running fake SDK:保持会话活跃，便于断言 active agents */
const pendingClient: SdkClient = {
  start: async function* (params) {
    for await (const _msg of params.prompt) {
      await new Promise(() => undefined);
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
  it("POST /debug/client-log 记录前端诊断事件并返回 ok", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const res = await request(app())
      .post("/api/debug/client-log")
      .send({
        event: "app.session-select",
        runId: "run-1",
        sessionId: "s1",
        detail: { source: "history-row" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(infoSpy).toHaveBeenCalledWith(
      "[cc-web:client]",
      expect.objectContaining({
        event: "app.session-select",
        runId: "run-1",
        sessionId: "s1",
      })
    );
  });

  it("GET /debug/logs 返回最近的诊断日志，便于浏览器操作后排查", async () => {
    const a = app();

    await request(a)
      .post("/api/debug/client-log")
      .send({ event: "app.session-select", runId: "run-1" });

    const res = await request(a).get("/api/debug/logs");

    expect(res.status).toBe(200);
    expect(res.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "client",
          event: "app.session-select",
          runId: "run-1",
        }),
      ])
    );
  });

  it.skip("P2-B3: 会话结束时有 SSE 连接，宽限计时器场景较难用 supertest 测试", async () => {
    // P2-B3 问题：会话结束时正好有 SSE 连接，不启动宽限计时器；
    // 若后续连接断开但未触发 onClose（网络闪断），hub 永久驻留。
    //
    // 建议修复：无论是否有连接都预约清理，有连接时由 onClose 取消并重启。
    //
    // 此测试场景需要模拟：
    // 1. SSE 连接建立
    // 2. 会话结束（closed 事件）
    // 3. SSE 连接意外断开但不触发 onClose（网络闪断）
    // 4. 验证 hub 最终会被清理
    //
    // supertest 无法精确控制 SSE 连接的 onClose 触发时机，
    // 需要更复杂的集成测试或手动测试来验证此边界条件。
  });
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

  it("POST /sessions/:runId/respond 当待答项已失效时返回 ok:false", async () => {
    const a = app();
    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const res = await request(a)
      .post(`/api/sessions/${runId}/respond`)
      .send({ kind: "permission", id: "missing-prompt", decision: "allow" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false });
  });

  it("POST /sessions/:runId/message forwards uploaded attachment refs as uploadsDir file paths", async () => {
    const received: string[] = [];
    const client: SdkClient = {
      start: async function* (params) {
        for await (const msg of params.prompt) {
          received.push(String(msg.message.content));
          break;
        }
      },
    };
    const mgr = new SessionManager({
      client,
      permissionMode: "default",
      maxConcurrent: 4,
      idleTimeoutMs: 60_000,
    });
    const a = express();
    a.use(express.json());
    a.use("/api", createChatRouter(mgr, undefined, undefined, "C:/uploads"));

    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const res = await request(a)
      .post(`/api/sessions/${runId}/message`)
      .send({
        text: "请看附件",
        attachments: ["abc.png", "../escape.pdf", "nested/report.txt"],
      });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(res.status).toBe(200);
    expect(received[0]).toContain("请看附件");
    expect(received[0]).toContain(path.normalize("C:/uploads/abc.png"));
    expect(received[0]).toContain(path.normalize("C:/uploads/escape.pdf"));
    expect(received[0]).toContain(path.normalize("C:/uploads/report.txt"));
    expect(received[0]).not.toContain("..");
  });

  it("GET /sessions/:runId 返回 run 存活状态,供前端快速探活", async () => {
    const a = app();
    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const live = await request(a).get(`/api/sessions/${runId}`);
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ runId, active: true });

    const missing = await request(a).get("/api/sessions/ghost");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("session not found");
  });

  it("POST /sessions/:runId/heartbeat refreshes browser lease", async () => {
    const a = app();
    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const res = await request(a).post(`/api/sessions/${runId}/heartbeat`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      runId,
      status: "idle",
      attached: true,
    });
    expect(typeof res.body.leaseExpiresAt).toBe("number");

    const missing = await request(a).post("/api/sessions/ghost/heartbeat").send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("session not found");
  });

  it("GET /sessions/active returns active agents and maxConcurrent", async () => {
    const mgr = new SessionManager({
      client: pendingClient,
      permissionMode: "default",
      maxConcurrent: 3,
      idleTimeoutMs: 60_000,
    });
    const a = express();
    a.use(express.json());
    a.use("/api", createChatRouter(mgr));

    const newRes = await request(a).post("/api/sessions/new").send({ cwd: "C:/p1" });
    const continueRes = await request(a).post("/api/sessions/s-continue/continue").send({ projectId: "proj-2" });
    await request(a).post(`/api/sessions/${newRes.body.runId}/message`).send({ text: "ping new" });
    await request(a).post(`/api/sessions/${continueRes.body.runId}/message`).send({ text: "ping continue" });

    const res = await request(a).get("/api/sessions/active");

    expect(res.status).toBe(200);
    expect(res.body.maxConcurrent).toBe(3);
    expect(res.body.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: newRes.body.runId,
          kind: "new",
          cwd: "C:/p1",
          status: "executing",
        }),
        expect.objectContaining({
          runId: continueRes.body.runId,
          kind: "continue",
          sessionId: "s-continue",
          projectId: "proj-2",
          status: "executing",
        }),
      ])
    );
  });

  it("POST /sessions/:runId/close forcibly closes an active agent", async () => {
    const mgr = new SessionManager({
      client: echoClient,
      permissionMode: "default",
      maxConcurrent: 3,
      idleTimeoutMs: 60_000,
    });
    const closeSpy = vi.spyOn(mgr, "close");
    const a = express();
    a.use(express.json());
    a.use("/api", createChatRouter(mgr));

    const startRes = await request(a).post("/api/sessions/new").send({});
    const runId = startRes.body.runId as string;

    const res = await request(a).post(`/api/sessions/${runId}/close`).send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(closeSpy).toHaveBeenCalledWith(runId, "aborted");
    expect(mgr.get(runId)).toBeUndefined();
  });

  it("POST /sessions/new when maxConcurrent reached returns 409 friendly error", async () => {
    const mgr = new SessionManager({
      client: echoClient,
      permissionMode: "default",
      maxConcurrent: 1,
      idleTimeoutMs: 60_000,
    });
    const a = express();
    a.use(express.json());
    a.use("/api", createChatRouter(mgr));

    const first = await request(a).post("/api/sessions/new").send({});
    expect(first.status).toBe(200);

    const second = await request(a).post("/api/sessions/new").send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/max concurrent/i);
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

  it("多个 SSE 订阅者同时连接同一 run 时都能收到事件", async () => {
    const a = app();
    const server = a.listen(0);
    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const startRes = await request(baseUrl).post("/api/sessions/new").send({});
      const runId = startRes.body.runId as string;

      const first = openRawSse(`${baseUrl}/api/sessions/${runId}/stream`);
      const second = openRawSse(`${baseUrl}/api/sessions/${runId}/stream`);
      await Promise.all([first.opened, second.opened]);

      await request(baseUrl).post(`/api/sessions/${runId}/message`).send({ text: "ping" });

      const [firstBody, secondBody] = await Promise.all([first.done, second.done]);

      expect(firstBody).toContain(`"type":"turn_end"`);
      expect(secondBody).toContain(`"type":"turn_end"`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("复用 sessionId 重新续聊:新连接不得重放上一轮残留的 closed 事件", async () => {
    const a = app();

    // 1) 续聊 sX:建立第一轮会话(echoClient 空闲,不发消息即 idle)
    await request(a).post("/api/sessions/sX/continue").send({});

    // 2) 切走:DELETE 触发 release → 空闲会话 detach → 向 hub 日志写入 closed 事件
    await request(a).delete("/api/sessions/sX");

    // 3) 再次续聊 sX:同一 runId 重建会话,hub 不应继续携带上一轮的 closed
    await request(a).post("/api/sessions/sX/continue").send({});

    // 4) 订阅 stream:读取一小段重放内容
    const res = await request(a)
      .get("/api/sessions/sX/stream")
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        const stop = setTimeout(
          () => (r as unknown as { destroy: () => void }).destroy(),
          200
        );
        r.on("data", (c: Buffer) => {
          data += c.toString();
        });
        r.on("close", () => {
          clearTimeout(stop);
          cb(null, data);
        });
        r.on("end", () => {
          clearTimeout(stop);
          cb(null, data);
        });
      });

    const body = (res.text ?? (res.body as string)) as string;
    // 新一轮的重放里不应出现上一轮残留的 closed 事件
    expect(body).not.toContain(`"type":"closed"`);
  });

  // 占位测试:P2-B3 Hub 宽限计时器问题(已知但暂不修复)
  // 当前实现:会话结束时若有 SSE 连接,不启动宽限计时器
  // 若网络异常未触发 onClose,hub 永久驻留(内存泄漏)
  // 修复方案:无论是否有连接都启动计时器,onClose 时取消并重启
  it.skip("会话结束时应立即启动宽限计时器,无论是否有 SSE 连接", async () => {
    // 此测试标记为 skip,留待后续修复 P2-B3 时启用
    expect(true).toBe(true);
  });

  describe("POST /sessions/new with cwd", () => {
    it("宿主 path.isAbsolute 不识别 Windows 路径时，仍应接受合法 cwd", async () => {
      const isAbsoluteSpy = vi
        .spyOn(path, "isAbsolute")
        .mockImplementation((value) => String(value).startsWith("/"));

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
          (cwd) => cwd === "C:/valid/project"
        )
      );

      const res = await request(a)
        .post("/api/sessions/new")
        .send({ cwd: "C:/valid/project" });

      expect(res.status).toBe(200);
      expect(typeof res.body.runId).toBe("string");
      expect(spy).toHaveBeenCalledWith(expect.anything(), "C:/valid/project");

      isAbsoluteSpy.mockRestore();
    });

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

function openRawSse(url: string): {
  readonly opened: Promise<void>;
  readonly done: Promise<string>;
} {
  let resolveOpened!: () => void;
  const opened = new Promise<void>((resolve) => {
    resolveOpened = resolve;
  });
  const done = new Promise<string>((resolve, reject) => {
    let data = "";
    const req = http.get(url, (res) => {
      resolveOpened();
      const timeout = setTimeout(() => {
        req.destroy();
        resolve(data);
      }, 800);
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes(`"type":"turn_end"`)) {
          clearTimeout(timeout);
          req.destroy();
          resolve(data);
        }
      });
      res.on("error", reject);
      res.on("end", () => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNRESET") return;
      reject(error);
    });
  });
  return { opened, done };
}
