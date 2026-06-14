import { describe, it, expect } from "vitest";
import { Session } from "./session.js";
import type { SdkClient, StartQueryParams } from "./sdk.js";
import type { ServerEvent } from "@cc-web/shared";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

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
});
