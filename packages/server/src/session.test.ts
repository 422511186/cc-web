import { describe, it, expect } from "vitest";
import { Session } from "./session.js";
import type { SdkClient, StartQueryParams } from "./sdk.js";
import type { ServerEvent } from "@cc-web/shared";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

/** 用一个可手动投递消息的 fake SDK 客户端 */
function fakeClient(
  script: (params: StartQueryParams) => AsyncIterable<SDKMessage>
): SdkClient {
  return { start: script };
}

/** 收集会话发出的事件 */
function collector() {
  const events: ServerEvent[] = [];
  return { events, onEvent: (e: ServerEvent) => events.push(e) };
}

describe("Session", () => {
  it("isBusy:执行中为 true,turn_end 后回到 false", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const client = fakeClient(async function* (params) {
      for await (const _msg of params.prompt) {
        await gate; // 卡在执行中
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          uuid: "r1",
        } as unknown as SDKMessage;
      }
    });

    const { onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    expect(session.isBusy()).toBe(false); // 还没发消息

    session.send("go");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));
    expect(session.isBusy()).toBe(true); // 执行中

    release!();
    await new Promise((r) => setTimeout(r, 20));
    expect(session.isBusy()).toBe(false); // 一轮结束,回到空闲

    session.detach();
    await done;
  });

  it("isBusy:有待答项(等用户回答)时为 true", async () => {
    const client = fakeClient(async function* (params) {
      await params.canUseTool("Bash", { command: "x" }, { toolUseID: "t1" });
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("x");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));
    expect(session.isBusy()).toBe(true); // 挂起等待权限回答

    session.detach();
    await done;
  });

  it("send 回显用户消息:emit user_message 事件(供重连重放)", async () => {
    const client = fakeClient(async function* (params) {
      for await (const _msg of params.prompt) break;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("你好");
    expect(events).toContainEqual({ type: "user_message", text: "你好" });
    session.detach();
  });

  it("translates assistant text block into block + turn_end events", async () => {
    const client = fakeClient(async function* () {
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          model: "m",
          content: [{ type: "text", text: "hi there" }],
        },
        parent_tool_use_id: null,
        uuid: "u1",
        session_id: "s1",
      } as unknown as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hi there",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("hello");
    await session.runToCompletion();

    expect(events).toContainEqual({
      type: "block",
      block: { kind: "text", text: "hi there" },
    });
    expect(events).toContainEqual({ type: "turn_end", isError: false });
  });

  it("emits permission prompt and suspends until allowed", async () => {
    let resolveDecision: ((r: { behavior: string }) => void) | null = null;
    const client = fakeClient(async function* (params) {
      const decisionPromise = params.canUseTool(
        "Bash",
        { command: "npm test" },
        { toolUseID: "t1", title: "Claude wants to run npm test" }
      );
      decisionPromise.then((r) => {
        resolveDecision?.(r as { behavior: string });
      });
      const decision = await decisionPromise;
      expect(decision.behavior).toBe("allow");
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("run tests");

    const done = session.runToCompletion();

    await new Promise((r) => setTimeout(r, 20));
    const promptEvent = events.find((e) => e.type === "prompt");
    expect(promptEvent).toBeDefined();
    const prompt = (
      promptEvent as { prompt: { kind: string; id: string; toolName: string } }
    ).prompt;
    expect(prompt.kind).toBe("permission");
    expect(prompt.toolName).toBe("Bash");

    const ok = session.answer({
      kind: "permission",
      id: prompt.id,
      decision: "allow",
    });
    expect(ok).toBe(true);

    await done;
    expect(events).toContainEqual({ type: "turn_end", isError: false });
  });

  it("maps AskUserQuestion tool into a question prompt", async () => {
    const client = fakeClient(async function* (params) {
      const decision = await params.canUseTool(
        "AskUserQuestion",
        {
          questions: [
            {
              header: "DB",
              question: "Which database?",
              multiSelect: false,
              options: [
                { label: "Postgres", description: "relational" },
                { label: "Mongo", description: "document" },
              ],
            },
          ],
        },
        { toolUseID: "t1" }
      );
      expect(decision.behavior).toBe("allow");
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("ask me");
    const done = session.runToCompletion();

    await new Promise((r) => setTimeout(r, 20));
    const promptEvent = events.find((e) => e.type === "prompt");
    const prompt = (promptEvent as { prompt: { kind: string; id: string } })
      .prompt;
    expect(prompt.kind).toBe("question");

    session.answer({ kind: "question", id: prompt.id, answers: [["Postgres"]] });
    await done;
  });

  it("close rejects pending prompts and emits closed", async () => {
    const client = fakeClient(async function* (params) {
      await params.canUseTool("Bash", { command: "sleep" }, { toolUseID: "t1" });
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("x");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));

    session.close("idle");
    await done;
    expect(events).toContainEqual({ type: "closed", reason: "idle" });
  });

  it("detach 不中断正在执行的轮次:不 abort,等输入流自然结束后才完成", async () => {
    let captured: StartQueryParams | null = null;
    // 第一轮产出 result 后,循环回去读下一条输入(挂起),模拟"执行完一轮、等下一步"
    const client = fakeClient(async function* (params) {
      captured = params;
      for await (const _msg of params.prompt) {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          uuid: "r1",
        } as unknown as SDKMessage;
      }
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("go");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));

    // 前端断开 → 优雅分离:不应 abort
    session.detach();
    await done;

    expect(captured!.abortController.signal.aborted).toBe(false);
    expect(events).toContainEqual({ type: "turn_end", isError: false });
    // 分离也应发出 closed,reason 为 detached
    expect(events).toContainEqual({ type: "closed", reason: "detached" });
  });

  it("send 时 emit status:executing(供前端展示执行中)", () => {
    const client = fakeClient(async function* (params) {
      for await (const _msg of params.prompt) break;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("go");
    expect(events).toContainEqual({ type: "status", state: "executing" });
    session.detach();
  });

  it("result(turn_end) 时 emit status:idle(回到空闲可发下一条)", async () => {
    const client = fakeClient(async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("go");
    await session.runToCompletion();
    expect(events).toContainEqual({ type: "status", state: "idle" });
  });

  it("状态转移顺序:executing→waiting(待答)→executing(答后)→idle(结束)", async () => {
    const client = fakeClient(async function* (params) {
      await params.canUseTool("Bash", { command: "x" }, { toolUseID: "t1" });
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("x");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));

    const promptEvent = events.find((e) => e.type === "prompt");
    const prompt = (promptEvent as { prompt: { id: string } }).prompt;
    session.answer({ kind: "permission", id: prompt.id, decision: "allow" });
    await done;

    const states = events
      .filter((e) => e.type === "status")
      .map((e) => (e as { state: string }).state);
    expect(states).toEqual(["executing", "waiting", "executing", "idle"]);
  });

  it("从 assistant 消息提取 model 并 emit run_info", async () => {
    const client = fakeClient(async function* () {
      yield {
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: "hi" }],
        },
        parent_tool_use_id: null,
        uuid: "u1",
        session_id: "s1",
      } as unknown as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hi",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("hello");
    await session.runToCompletion();
    expect(events).toContainEqual({
      type: "run_info",
      model: "claude-opus-4-8",
    });
  });

  it("同一 model 多条 assistant 消息只 emit 一次 run_info", async () => {
    const assistantMsg = {
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "hi" }],
      },
      parent_tool_use_id: null,
      uuid: "u1",
      session_id: "s1",
    } as unknown as SDKMessage;
    const client = fakeClient(async function* () {
      yield assistantMsg;
      yield assistantMsg;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hi",
        session_id: "s1",
        uuid: "r1",
      } as unknown as SDKMessage;
    });
    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("hello");
    await session.runToCompletion();
    const runInfos = events.filter((e) => e.type === "run_info");
    expect(runInfos).toHaveLength(1);
  });

  it("detach 后再 close 不重复 abort、不重复发 closed", async () => {
    let captured: StartQueryParams | null = null;
    const client = fakeClient(async function* (params) {
      captured = params;
      for await (const _msg of params.prompt) {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          uuid: "r1",
        } as unknown as SDKMessage;
      }
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("go");
    const done = session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));

    session.detach();
    await done;
    // 模拟 manager 在任务结束后的兜底 close
    session.close("exited");

    const closedEvents = events.filter((e) => e.type === "closed");
    expect(closedEvents).toHaveLength(1);
    expect(closedEvents[0]).toEqual({ type: "closed", reason: "detached" });
    expect(captured!.abortController.signal.aborted).toBe(false);
  });

  it("续聊第二轮用不同模型时应重新上报新模型", async () => {
    let round = 0;
    const client = fakeClient(async function* (params) {
      for await (const _msg of params.prompt) {
        round++;
        const model = round === 1 ? "claude-opus-4-8" : "claude-sonnet-4-6";
        yield {
          type: "assistant",
          message: {
            role: "assistant",
            model,
            content: [{ type: "text", text: "reply" }],
          },
          parent_tool_use_id: null,
          uuid: `u${round}`,
          session_id: "s1",
        } as unknown as SDKMessage;
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          uuid: `r${round}`,
        } as unknown as SDKMessage;
      }
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });

    // 不直接 await runToCompletion,让它在后台运行
    void session.runToCompletion();

    // 第一轮
    session.send("first");
    await new Promise((r) => setTimeout(r, 50));

    // 第二轮
    session.send("second");
    await new Promise((r) => setTimeout(r, 50));

    // 关闭以结束循环
    session.close("done");

    const runInfos = events.filter((e) => e.type === "run_info");
    // 修复后:每次 send 重置 reportedModel,两轮不同模型都会上报
    expect(runInfos).toHaveLength(2);
    expect(runInfos[0]).toEqual({ type: "run_info", model: "claude-opus-4-8" });
    expect(runInfos[1]).toEqual({ type: "run_info", model: "claude-sonnet-4-6" });
  });

  it("abortCurrentTurn 只停止当前轮次,不发 closed 终态", async () => {
    let captured: StartQueryParams | null = null;
    const client = fakeClient(async function* (params) {
      captured = params;
      for await (const _msg of params.prompt) {
        await new Promise(() => {});
      }
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("long task");
    void session.runToCompletion();
    await new Promise((r) => setTimeout(r, 20));

    session.abortCurrentTurn();

    expect(captured!.abortController.signal.aborted).toBe(true);
    expect(events).toContainEqual({ type: "status", state: "idle" });
    expect(events.some((e) => e.type === "closed")).toBe(false);
    expect(session.isBusy()).toBe(false);
  });

  it("abortCurrentTurn 后下一次启动应复用已学习到的 session id", async () => {
    const starts: Array<{ resume?: string }> = [];
    const client: SdkClient = {
      start: async function* (params) {
        starts.push({ resume: params.resume });
        let turn = 0;
        for await (const _msg of params.prompt) {
          turn++;
          if (starts.length === 1 && turn === 1) {
            yield {
              type: "assistant",
              message: {
                role: "assistant",
                model: "claude-opus-4-8",
                content: [{ type: "text", text: "first" }],
              },
              parent_tool_use_id: null,
              uuid: "u1",
              session_id: "sdk-session-1",
            } as unknown as SDKMessage;
            yield {
              type: "result",
              subtype: "success",
              is_error: false,
              result: "ok",
              session_id: "sdk-session-1",
              uuid: "r1",
            } as unknown as SDKMessage;
            continue;
          }

          if (starts.length === 1 && turn === 2) {
            while (!params.abortController.signal.aborted) {
              await new Promise((r) => setTimeout(r, 5));
            }
            return;
          }

          return;
        }
      },
    };

    const { onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    const done = session.runToCompletion();

    session.send("first");
    await new Promise((r) => setTimeout(r, 40));

    session.send("second");
    await new Promise((r) => setTimeout(r, 20));
    session.abortCurrentTurn();

    await new Promise((r) => setTimeout(r, 20));
    session.send("third");
    await done;

    expect(starts).toHaveLength(2);
    expect(starts[0].resume).toBeUndefined();
    expect(starts[1].resume).toBe("sdk-session-1");
  });
});
