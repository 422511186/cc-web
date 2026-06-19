# CodeRelay Pub/Sub And Device Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CodeRelay 的实时会话升级为多前台发布订阅模型，并完善 Host 设备管理、短链二维码、撤销提示和 TURN 中继状态。

**Architecture:** Host 成为唯一状态提交者：`SessionBus` 负责事件日志、多订阅者广播、操作幂等、队列和 prompt 竞争提交；HTTP 与 P2P 只作为两种传输出口。Host 管理面继续挂在 `/host`，默认 HTTP 访问，负责短链配对、设备管理、配置覆盖和链路诊断；Signal 负责短码解析、配对窗口、信令交换和 TURN 配置下发，不实现自研 Transit。

**Tech Stack:** TypeScript, Node.js, Express, React, Vite, Vitest, Testing Library, Supertest, WebRTC DataChannel, npm workspaces.

---

## Specs

- `docs/superpowers/specs/2026-06-19-coderelay-session-pubsub-design.md`
- `docs/superpowers/specs/2026-06-19-coderelay-device-management-design.md`
- Existing reference: `docs/superpowers/specs/2026-06-18-coderelay-p2p-design.md`

## File Structure

- Create `apps/host/src/sessionBus.ts`: owns per-run event log, subscriber registry, operation idempotency, prompt resolution state and message queue metadata.
- Create `apps/host/src/sessionBus.test.ts`: unit tests for multi-subscriber broadcast, replay, operation idempotency and prompt first-writer-wins.
- Modify `apps/host/src/chatRoutes.ts`: replace single-channel Hub with `SessionBus`; route message/respond/mode operations through the bus.
- Modify `apps/host/src/session.ts`: add queued message processing and per-turn mode input; keep SDK interaction in this file.
- Modify `apps/host/src/sessionManager.ts`: expose session-level mode and queue operations without leaking HTTP details.
- Modify `packages/shared/src/events.ts`: add queue, prompt resolved, mode changed and revoked event contracts.
- Modify `packages/shared/src/api.ts`: add request/response contracts for operation IDs, mode changes and Host management API.
- Modify `apps/web/src/useSession.ts`: reduce new events idempotently.
- Modify `apps/web/src/App.tsx` and chat components: show mode selector, queue state, prompt already-resolved state and revoked guidance.
- Modify `apps/web/src/components/Composer.tsx`: expose image-only UI while preserving existing attachment request contract.
- Modify `apps/host/src/p2pRuntime.ts`: generate `pairCode` short links, store display names, emit revoke control messages, report topology/TURN route.
- Modify `apps/host/src/p2pRoutes.ts`: add Host management endpoints for settings, short pairing, devices and network state.
- Modify `apps/host/src/p2pManagementPage.ts`: render configurable Web/Signal URLs, short QR, devices, recent usage and topology.
- Modify `apps/signal/src/index.ts`: store `pairCode -> pairing metadata`, serve pairing lookup and keep TURN config endpoint.
- Modify `apps/web/src/p2pClient.ts`: support `/pair/<pairCode>` lookup, friendly device name generation and `device_revoked`.
- Modify `apps/web/src/api.ts`: add Host management client methods where Web needs them.
- Modify docs and scripts: document `PUBLIC_WEB_BASE_URL`, `PUBLIC_SIGNAL_URL`, TURN-only relay boundary, and update start scripts if they hard-code old URLs.

---

### Task 1: Shared Contracts For Pub/Sub Events

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/src/events.test.ts`

- [ ] **Step 1: Write the failing test**

Add this to `packages/shared/src/events.test.ts`:

```ts
import type {
  ServerEvent,
  ChangeModeRequest,
  ResolvePromptResponse,
} from "./index.js";

describe("session pub/sub contracts", () => {
  it("exposes queue, prompt resolution, mode and revoke events", () => {
    const events: ServerEvent[] = [
      { type: "message_queued", operationId: "op-1", queuePosition: 1 },
      { type: "message_processing", operationId: "op-1" },
      { type: "message_completed", operationId: "op-1" },
      {
        type: "prompt_resolved",
        promptId: "perm-1",
        resolvedByDeviceName: "Chrome on Android",
        decision: "allow",
      },
      {
        type: "mode_changed",
        mode: "plan",
        changedByDeviceName: "Edge on Windows",
        appliesTo: "next_turn",
      },
      { type: "device_revoked", message: "此设备授权已被 Host 撤销，请重新授权" },
    ];

    expect(events.map((event) => event.type)).toEqual([
      "message_queued",
      "message_processing",
      "message_completed",
      "prompt_resolved",
      "mode_changed",
      "device_revoked",
    ]);
  });

  it("exposes request and response types for mode and prompt operations", () => {
    const change: ChangeModeRequest = {
      operationId: "op-mode",
      mode: "bypassPermissions",
      clientId: "client-phone",
      deviceName: "Chrome on Android",
    };
    const response: ResolvePromptResponse = {
      ok: false,
      reason: "prompt_already_resolved",
      resolvedByDeviceName: "Edge on Windows",
    };

    expect(change.mode).toBe("bypassPermissions");
    expect(response.reason).toBe("prompt_already_resolved");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/shared -- src/events.test.ts
```

Expected: TypeScript compile fails because the new event and request types do not exist.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/events.ts`:

```ts
export type ClaudeSessionMode = "auto" | "plan" | "bypassPermissions";

export interface MessageQueuedEvent {
  type: "message_queued";
  operationId: string;
  queuePosition: number;
}

export interface MessageProcessingEvent {
  type: "message_processing";
  operationId: string;
}

export interface MessageCompletedEvent {
  type: "message_completed";
  operationId: string;
}

export interface MessageFailedEvent {
  type: "message_failed";
  operationId: string;
  message: string;
}

export interface PromptResolvedEvent {
  type: "prompt_resolved";
  promptId: string;
  resolvedByDeviceName: string;
  decision: string;
}

export interface ModeChangedEvent {
  type: "mode_changed";
  mode: ClaudeSessionMode;
  changedByDeviceName: string;
  appliesTo: "current_turn" | "next_turn";
}

export interface DeviceRevokedEvent {
  type: "device_revoked";
  message: string;
}
```

Include these interfaces in `ServerEvent`.

Add to `packages/shared/src/api.ts`:

```ts
import type { ClaudeSessionMode } from "./events.js";

export interface ClientOperationMetadata {
  operationId?: string;
  clientId?: string;
  deviceName?: string;
}

export interface ChangeModeRequest extends ClientOperationMetadata {
  mode: ClaudeSessionMode;
}

export interface ResolvePromptResponse {
  ok: boolean;
  reason?: "prompt_already_resolved" | "prompt_not_found";
  resolvedByDeviceName?: string;
}
```

Ensure `packages/shared/src/index.ts` exports these types if it uses explicit exports.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/shared -- src/events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/events.ts packages/shared/src/api.ts packages/shared/src/index.ts packages/shared/src/events.test.ts
git commit -m "feat: 定义会话发布订阅事件契约"
```

---

### Task 2: SessionBus Multi-Subscriber Core

**Files:**
- Create: `apps/host/src/sessionBus.ts`
- Create: `apps/host/src/sessionBus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/host/src/sessionBus.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionBus } from "./sessionBus.js";

describe("SessionBus", () => {
  it("broadcasts every event to every subscriber and replays the log", () => {
    const bus = new SessionBus({ runId: "run-1" });
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe("sub-1", first);
    bus.publish({ type: "status", state: "executing" });
    bus.subscribe("sub-2", second);
    bus.publish({ type: "status", state: "idle" });

    expect(first).toHaveBeenCalledWith({ type: "status", state: "executing" });
    expect(first).toHaveBeenCalledWith({ type: "status", state: "idle" });
    expect(second.mock.calls.map(([event]) => event)).toEqual([
      { type: "status", state: "executing" },
      { type: "status", state: "idle" },
    ]);
  });

  it("deduplicates operation ids", () => {
    const bus = new SessionBus({ runId: "run-1" });

    const first = bus.claimOperation("op-1", { ok: true });
    const second = bus.claimOperation("op-1", { ok: false });

    expect(first).toEqual({ first: true, result: { ok: true } });
    expect(second).toEqual({ first: false, result: { ok: true } });
  });

  it("resolves a prompt by first writer wins", () => {
    const bus = new SessionBus({ runId: "run-1" });

    bus.trackPrompt("perm-1");

    expect(bus.resolvePrompt("perm-1", "Chrome on Android", "allow")).toEqual({
      ok: true,
      resolvedByDeviceName: "Chrome on Android",
    });
    expect(bus.resolvePrompt("perm-1", "Edge on Windows", "deny")).toEqual({
      ok: false,
      reason: "prompt_already_resolved",
      resolvedByDeviceName: "Chrome on Android",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/sessionBus.test.ts
```

Expected: FAIL because `sessionBus.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/host/src/sessionBus.ts`:

```ts
import type { ServerEvent } from "@coderelay/shared";

export interface SessionBusOptions {
  readonly runId: string;
  readonly maxLogEvents?: number;
}

export type SessionSubscriber = (event: ServerEvent) => void;

export interface PromptResolutionResult {
  readonly ok: boolean;
  readonly reason?: "prompt_already_resolved" | "prompt_not_found";
  readonly resolvedByDeviceName?: string;
}

export class SessionBus {
  private readonly subscribers = new Map<string, SessionSubscriber>();
  private readonly log: ServerEvent[] = [];
  private readonly operations = new Map<string, unknown>();
  private readonly prompts = new Map<string, { resolvedByDeviceName?: string; decision?: string }>();
  private readonly maxLogEvents: number;

  constructor(private readonly options: SessionBusOptions) {
    this.maxLogEvents = options.maxLogEvents ?? 10_000;
  }

  subscribe(id: string, subscriber: SessionSubscriber): () => void {
    this.subscribers.set(id, subscriber);
    for (const event of this.log) subscriber(event);
    return () => {
      if (this.subscribers.get(id) === subscriber) {
        this.subscribers.delete(id);
      }
    };
  }

  publish(event: ServerEvent): void {
    this.log.push(event);
    if (this.log.length > this.maxLogEvents) {
      this.log.splice(0, this.log.length - this.maxLogEvents);
    }
    for (const subscriber of this.subscribers.values()) {
      subscriber(event);
    }
  }

  claimOperation<T>(operationId: string, result: T): { readonly first: boolean; readonly result: T } {
    if (this.operations.has(operationId)) {
      return { first: false, result: this.operations.get(operationId) as T };
    }
    this.operations.set(operationId, result);
    return { first: true, result };
  }

  trackPrompt(promptId: string): void {
    if (!this.prompts.has(promptId)) {
      this.prompts.set(promptId, {});
    }
  }

  resolvePrompt(promptId: string, deviceName: string, decision: string): PromptResolutionResult {
    const prompt = this.prompts.get(promptId);
    if (!prompt) return { ok: false, reason: "prompt_not_found" };
    if (prompt.resolvedByDeviceName) {
      return {
        ok: false,
        reason: "prompt_already_resolved",
        resolvedByDeviceName: prompt.resolvedByDeviceName,
      };
    }
    prompt.resolvedByDeviceName = deviceName;
    prompt.decision = decision;
    this.publish({
      type: "prompt_resolved",
      promptId,
      resolvedByDeviceName: deviceName,
      decision,
    });
    return { ok: true, resolvedByDeviceName: deviceName };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/sessionBus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/sessionBus.ts apps/host/src/sessionBus.test.ts
git commit -m "feat: 增加会话事件总线"
```

---

### Task 3: Replace Single SSE Channel With SessionBus Subscribers

**Files:**
- Modify: `apps/host/src/chatRoutes.ts`
- Modify: `apps/host/src/chatRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `apps/host/src/chatRoutes.test.ts`:

```ts
it("多个 SSE 订阅者同时连接同一 run 时都能收到事件", async () => {
  const a = app();
  const startRes = await request(a).post("/api/sessions/new").send({});
  const runId = startRes.body.runId as string;

  const openStream = () =>
    request(a)
      .get(`/api/sessions/${runId}/stream`)
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
          if (data.includes(`"type":"turn_end"`)) {
            (res as unknown as { destroy: () => void }).destroy();
          }
        });
        res.on("close", () => cb(null, data));
        res.on("end", () => cb(null, data));
      });

  const first = openStream();
  const second = openStream();
  await request(a).post(`/api/sessions/${runId}/message`).send({ text: "ping" });

  const [firstRes, secondRes] = await Promise.all([first, second]);
  const firstBody = (firstRes.text ?? firstRes.body) as string;
  const secondBody = (secondRes.text ?? secondRes.body) as string;

  expect(firstBody).toContain(`"type":"turn_end"`);
  expect(secondBody).toContain(`"type":"turn_end"`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/chatRoutes.test.ts -t "多个 SSE 订阅者"
```

Expected: FAIL because the existing Hub stores only one `channel`, so one stream misses events.

- [ ] **Step 3: Write minimal implementation**

In `apps/host/src/chatRoutes.ts`:

- Import `SessionBus`.
- Change `Hub` to hold `bus: SessionBus` and cleanup fields only.
- In `makeOnEvent(runId)`, call `hub.bus.publish(event)`.
- In stream route, replace `hub.channel = channel` with:

```ts
const subscriberId = `${runId}:${Date.now()}:${Math.random()}`;
const unsubscribe = hub.bus.subscribe(subscriberId, (event) => channel.send(event));
```

- In `channel.onClose`, call `unsubscribe()` instead of clearing a single channel.
- Cleanup logic must check `hub.bus.subscriberCount()`; add that method to `SessionBus`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/sessionBus.test.ts src/chatRoutes.test.ts -t "多个 SSE 订阅者|SessionBus"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/sessionBus.ts apps/host/src/chatRoutes.ts apps/host/src/chatRoutes.test.ts
git commit -m "feat: 支持会话多订阅者广播"
```

---

### Task 4: Prompt First-Writer-Wins Through HTTP

**Files:**
- Modify: `apps/host/src/chatRoutes.ts`
- Modify: `apps/host/src/session.ts`
- Modify: `apps/host/src/chatRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Add a fake SDK that triggers one permission prompt, then add:

```ts
it("同一权限卡片两个回答先到先得，后到返回已处理信息", async () => {
  const waitingClient: SdkClient = {
    start: async function* (params) {
      for await (const _msg of params.prompt) {
        const decision = await params.canUseTool?.("Bash", { command: "npm test" }, {
          signal: new AbortController().signal,
          suggestions: [],
        } as never);
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: JSON.stringify(decision),
          session_id: "s1",
          uuid: "r1",
        } as unknown as SDKMessage;
        break;
      }
    },
  };
  const mgr = new SessionManager({
    client: waitingClient,
    permissionMode: "default",
    maxConcurrent: 4,
    idleTimeoutMs: 60_000,
  });
  const a = express();
  a.use(express.json());
  a.use("/api", createChatRouter(mgr));

  const startRes = await request(a).post("/api/sessions/new").send({});
  const runId = startRes.body.runId as string;
  await request(a).post(`/api/sessions/${runId}/message`).send({ text: "run" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const first = await request(a)
    .post(`/api/sessions/${runId}/respond`)
    .send({ kind: "permission", id: "permission-1", decision: "allow", deviceName: "Chrome on Android" });
  const second = await request(a)
    .post(`/api/sessions/${runId}/respond`)
    .send({ kind: "permission", id: "permission-1", decision: "deny", deviceName: "Edge on Windows" });

  expect(first.body).toEqual({ ok: true });
  expect(second.body).toEqual({
    ok: false,
    reason: "prompt_already_resolved",
    resolvedByDeviceName: "Chrome on Android",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/chatRoutes.test.ts -t "先到先得"
```

Expected: FAIL because `/respond` currently returns only `{ ok }` and does not record resolver device.

- [ ] **Step 3: Write minimal implementation**

- Extend `PromptAnswer` handling to accept optional metadata without breaking existing callers.
- When `Session` emits a `prompt` event, `chatRoutes` calls `hub.bus.trackPrompt(prompt.id)`.
- In `/respond`, call `hub.bus.resolvePrompt(answer.id, deviceName, decision)` before `session.answer(answer)`.
- If bus returns `prompt_already_resolved`, respond with that body and do not call `session.answer`.
- Use fallback `deviceName = "此设备"` when not provided.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/chatRoutes.test.ts -t "先到先得"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/chatRoutes.ts apps/host/src/session.ts apps/host/src/chatRoutes.test.ts
git commit -m "feat: 权限响应支持先到先得"
```

---

### Task 5: Queued Messages While Claude Is Busy

**Files:**
- Modify: `apps/host/src/session.ts`
- Modify: `apps/host/src/session.test.ts`
- Modify: `apps/host/src/chatRoutes.ts`
- Modify: `apps/host/src/chatRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/host/src/session.test.ts`:

```ts
it("执行中收到多条消息时按 FIFO 排队处理", async () => {
  const starts: string[] = [];
  const releases: Array<() => void> = [];
  const client = {
    start: async function* (params) {
      for await (const msg of params.prompt) {
        starts.push(String(msg.message.content));
        await new Promise<void>((resolve) => releases.push(resolve));
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "s1",
          uuid: `r-${starts.length}`,
        } as unknown as SDKMessage;
      }
    },
  };
  const events: ServerEvent[] = [];
  const session = new Session({
    client,
    permissionMode: "default",
    onEvent: (event) => events.push(event),
  });

  session.send("one");
  session.send("two");
  session.send("three");
  await waitFor(() => starts.length === 1);
  releases.shift()?.();
  await waitFor(() => starts.length === 2);
  releases.shift()?.();
  await waitFor(() => starts.length === 3);

  expect(starts).toEqual(["one", "two", "three"]);
  expect(events).toContainEqual({ type: "message_queued", operationId: expect.any(String), queuePosition: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/session.test.ts -t "FIFO"
```

Expected: FAIL because current `Session.send` writes directly to `InputQueue` without queue metadata.

- [ ] **Step 3: Write minimal implementation**

- Add an internal `pendingMessages` array to `Session`.
- Change `send(text, attachments, metadata?)` to enqueue when `isBusy()` is true.
- Emit `message_queued`, `message_processing`, `message_completed`.
- After `turn_end`, dequeue the next message and send it to `InputQueue`.
- Preserve existing behavior for a single idle message.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/session.test.ts -t "FIFO"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/session.ts apps/host/src/session.test.ts apps/host/src/chatRoutes.ts apps/host/src/chatRoutes.test.ts
git commit -m "feat: 忙碌会话支持消息排队"
```

---

### Task 6: Session-Level Claude Mode

**Files:**
- Modify: `apps/host/src/session.ts`
- Modify: `apps/host/src/sessionManager.ts`
- Modify: `apps/host/src/chatRoutes.ts`
- Modify: `apps/host/src/session.test.ts`
- Modify: `apps/host/src/chatRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/host/src/chatRoutes.test.ts`:

```ts
it("PATCH /sessions/:runId/mode changes session mode and broadcasts mode_changed", async () => {
  const a = app();
  const startRes = await request(a).post("/api/sessions/new").send({});
  const runId = startRes.body.runId as string;

  const stream = request(a)
    .get(`/api/sessions/${runId}/stream`)
    .buffer(true)
    .parse((res, cb) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes(`"type":"mode_changed"`)) {
          (res as unknown as { destroy: () => void }).destroy();
        }
      });
      res.on("close", () => cb(null, data));
      res.on("end", () => cb(null, data));
    });

  const res = await request(a)
    .patch(`/api/sessions/${runId}/mode`)
    .send({
      operationId: "mode-op-1",
      mode: "plan",
      clientId: "client-phone",
      deviceName: "Chrome on Android",
    });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, mode: "plan", appliesTo: "next_turn" });
  const body = ((await stream).text ?? (await stream).body) as string;
  expect(body).toContain(`"type":"mode_changed"`);
  expect(body).toContain(`"mode":"plan"`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/chatRoutes.test.ts -t "mode_changed"
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Write minimal implementation**

- Add `PATCH /sessions/:runId/mode`.
- Validate mode is `auto`, `plan`, or `bypassPermissions`.
- Store mode in `Session`.
- Emit `mode_changed`.
- Return `appliesTo: "next_turn"` because current SDK query options cannot be mutated mid-turn safely.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/chatRoutes.test.ts -t "mode_changed"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/session.ts apps/host/src/sessionManager.ts apps/host/src/chatRoutes.ts apps/host/src/session.test.ts apps/host/src/chatRoutes.test.ts
git commit -m "feat: 支持会话级 Claude 模式"
```

---

### Task 7: Web Reducer And UI For Pub/Sub State

**Files:**
- Modify: `apps/web/src/useSession.ts`
- Modify: `apps/web/src/useSession.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/chatApi.ts`
- Modify: `apps/web/src/components/PermissionCard.tsx`
- Modify: `apps/web/src/components/PlanCard.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/useSession.test.ts`:

```ts
test("prompt_resolved clears pending and records resolver device", () => {
  const { result } = renderHook(() => useSession("run-1"));

  act(() => {
    FakeEventSource.instances[0].emit({
      type: "prompt",
      prompt: {
        kind: "permission",
        id: "perm-1",
        toolName: "Bash",
        title: "Claude wants to run npm test",
        detail: "npm test",
      },
    } as ServerEvent);
    FakeEventSource.instances[0].emit({
      type: "prompt_resolved",
      promptId: "perm-1",
      resolvedByDeviceName: "Chrome on Android",
      decision: "allow",
    } as ServerEvent);
  });

  expect(result.current.pending).toBeNull();
  expect(result.current.lastPromptResolution).toEqual({
    promptId: "perm-1",
    resolvedByDeviceName: "Chrome on Android",
    decision: "allow",
  });
});

test("mode_changed updates current session mode", () => {
  const { result } = renderHook(() => useSession("run-1"));

  act(() => {
    FakeEventSource.instances[0].emit({
      type: "mode_changed",
      mode: "plan",
      changedByDeviceName: "Edge on Windows",
      appliesTo: "next_turn",
    } as ServerEvent);
  });

  expect(result.current.mode).toBe("plan");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/web -- src/useSession.test.ts -t "prompt_resolved|mode_changed"
```

Expected: FAIL because `useSession` does not expose these fields.

- [ ] **Step 3: Write minimal implementation**

- Add `mode` and `lastPromptResolution` state to `useSession`.
- Handle `prompt_resolved` by clearing matching pending and storing resolver info.
- Handle `mode_changed` by updating mode.
- Add `changeMode(runId, body)` to `chatApi.ts`.
- In `App.tsx`, render a compact segmented control for `auto / plan / bypassPermissions`.
- Before sending `bypassPermissions`, show existing `AlertDialog` or a confirm dialog with high-risk copy.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/web -- src/useSession.test.ts
npm test --workspace @coderelay/web -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/useSession.ts apps/web/src/useSession.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/chatApi.ts apps/web/src/components/PermissionCard.tsx apps/web/src/components/PlanCard.tsx
git commit -m "feat: 前端同步会话模式与权限处理状态"
```

---

### Task 8: Host Settings And Short Pairing URL

**Files:**
- Modify: `apps/host/src/p2pRuntime.ts`
- Modify: `apps/host/src/p2pRoutes.ts`
- Modify: `apps/host/src/p2pRuntime.test.ts`
- Modify: `apps/host/src/app.test.ts`
- Modify: `apps/signal/src/index.ts`
- Modify: `apps/signal/src/signalHub.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/host/src/p2pRuntime.test.ts`:

```ts
it("opens a pairing with a short /pair code URL instead of embedding the full offer", async () => {
  const signal = new FakeSignalSocket();
  const runtime = new HostP2PRuntime({
    signalUrl: "ws://signal.test/",
    hostId: "host-test",
    webUrl: "http://web.test/",
    localApiBaseUrl: "http://127.0.0.1:3002/api",
    authToken: "test-token-123456",
    now: () => Date.parse("2026-06-19T00:00:00.000Z"),
    createPairingId: () => "pair-test",
    createPairingSecret: () => "secret-test",
    createPairingCode: () => "ABCD12",
    createSignalSocket: () => signal,
    createPeerConnection: () => new FakePeerConnection(),
    createBridge: vi.fn(() => ({ close: vi.fn() })),
  });

  await runtime.start();
  const pairing = runtime.openPairing({});

  expect(pairing.pairingUrl).toBe("http://web.test/pair/ABCD12");
  expect(pairing.pairingUrl).not.toContain("p2p=");
  expect(signal.sent).toContainEqual(expect.objectContaining({
    type: "pairing.open",
    pairCode: "ABCD12",
    offer: pairing.offer,
  }));
});
```

Add to `apps/host/src/app.test.ts`:

```ts
it("Host management and P2P management APIs do not require AUTH_TOKEN", async () => {
  const app = createApp(testConfig(), fakeStore(), undefined, fakeSdkClient(), fakeP2PRuntime());

  const page = await request(app).get("/host");
  const management = await request(app).get("/api/p2p/management");

  expect(page.status).toBe(200);
  expect(management.status).toBe(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts -t "short /pair"
npm test --workspace @coderelay/host -- src/app.test.ts -t "do not require AUTH_TOKEN"
```

Expected: first test FAIL because old URL uses `?p2p=...`; second may pass today and should stay green as a guard.

- [ ] **Step 3: Write minimal implementation**

- Add `createPairingCode?: () => string` to `HostP2PRuntimeOptions`.
- Add `pairCode` to pairing result.
- Change `pairingUrlFor(webUrl, pairCode)` to return `/pair/<pairCode>`.
- Send `pairCode` and `offer` in `pairing.open` to Signal.
- In Signal, store `pairCode -> offer` until expiry.
- Add a Signal request `pairing.lookup` returning `pairing.offer` or `signal.error`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts src/app.test.ts
npm test --workspace @coderelay/signal -- src/signalHub.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/p2pRuntime.ts apps/host/src/p2pRoutes.ts apps/host/src/p2pRuntime.test.ts apps/host/src/app.test.ts apps/signal/src/index.ts apps/signal/src/signalHub.test.ts
git commit -m "feat: 配对二维码改为短链接"
```

---

### Task 9: Browser Pair Route And Friendly Device Names

**Files:**
- Modify: `apps/web/src/p2pClient.ts`
- Modify: `apps/web/src/p2pClient.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/host/src/p2pRuntime.ts`
- Modify: `packages/p2p-core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/p2pClient.test.ts`:

```ts
it("looks up a short pair code and sends a friendly device name", async () => {
  const socket = new FakeWebSocket();
  const sessionPromise = connectBrowserP2PFromPairCode("ABCD12", {
    signalUrl: "ws://signal.test/",
    createWebSocket: () => {
      queueMicrotask(() => socket.open());
      return socket as unknown as WebSocket;
    },
    createPeerConnection: () => new FakePeerConnection(new FakeDataChannel()) as unknown as RTCPeerConnection,
    detectDeviceName: () => "Chrome on Android",
    timeoutMs: 1000,
  });

  await waitFor(() => socket.sent.some((message) => message.type === "pairing.lookup"));
  expect(socket.sent).toContainEqual({
    type: "pairing.lookup",
    requestId: expect.any(String),
    pairCode: "ABCD12",
  });

  socket.message({
    type: "pairing.offer",
    requestId: socket.sent[0].requestId,
    offer: pairingOffer(),
  });

  await waitFor(() => socket.sent.some((message) => message.type === "pairing.request"));
  expect(socket.sent.find((message) => message.type === "pairing.request")).toEqual(
    expect.objectContaining({ displayName: "Chrome on Android" })
  );

  await expect(sessionPromise).rejects.toThrow("等待 Host 接受设备配对超时");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/web -- src/p2pClient.test.ts -t "friendly device name"
```

Expected: FAIL because `connectBrowserP2PFromPairCode` does not exist.

- [ ] **Step 3: Write minimal implementation**

- Export `connectBrowserP2PFromPairCode(pairCode, options)`.
- Add `detectDeviceName()` helper using `navigator.userAgentData` when available, otherwise `navigator.userAgent`.
- Include `displayName` in `pairing.request`.
- Host `handlePairingRequest` passes `displayName` to `acceptPairingProof` instead of `clientId`.
- `/pair/<code>` in `App.tsx` starts short-code lookup flow.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/web -- src/p2pClient.test.ts
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/p2pClient.ts apps/web/src/p2pClient.test.ts apps/web/src/App.tsx apps/web/src/App.test.tsx apps/host/src/p2pRuntime.ts packages/p2p-core/src/index.ts
git commit -m "feat: 支持短码配对和友好设备名"
```

---

### Task 10: Device Revocation Control Event

**Files:**
- Modify: `apps/host/src/p2pRuntime.ts`
- Modify: `apps/host/src/p2pRuntime.test.ts`
- Modify: `apps/web/src/p2pClient.ts`
- Modify: `apps/web/src/p2pClient.test.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `apps/host/src/p2pRuntime.test.ts`:

```ts
it("sends device_revoked before closing an active peer", async () => {
  const clientIdentity = await createDeviceIdentity({
    deviceId: "client-phone",
    createdAt: "2026-06-19T00:00:00.000Z",
  });
  const signal = new FakeSignalSocket();
  const channel = new FakeDataChannel();
  const peer = new FakePeerConnection();
  const runtime = new HostP2PRuntime({
    signalUrl: "ws://signal.test/",
    hostId: "host-test",
    webUrl: "http://web.test/",
    localApiBaseUrl: "http://127.0.0.1:3002/api",
    authToken: "test-token-123456",
    trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
      clientId: clientIdentity.deviceId,
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      displayName: "Chrome on Android",
      addedAt: "2026-06-19T00:00:00.000Z",
    }),
    createSignalSocket: () => signal,
    createPeerConnection: () => peer,
    createBridge: vi.fn(() => ({ close: vi.fn() })),
  });

  await runtime.start();
  signal.emitMessage({
    type: "client.connect",
    requestId: "req-client",
    hostId: "host-test",
    clientId: clientIdentity.deviceId,
    clientPublicKeyJwk: clientIdentity.publicKeyJwk,
    clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
  });
  await answerConnectionChallenge(signal, "req-client", clientIdentity);
  peer.emitDataChannel(channel);

  await runtime.revokeDevice("client-phone");

  expect(channel.sent.map((raw) => JSON.parse(raw))).toContainEqual({
    type: "event",
    event: {
      type: "device_revoked",
      message: "此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。",
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts -t "device_revoked"
```

Expected: FAIL because revoke currently closes the peer without a control event.

- [ ] **Step 3: Write minimal implementation**

- Store active data channel or bridge control sender in `HostP2PRuntime`.
- Before `closePeer()`, send a control frame carrying `device_revoked`.
- In Web P2P transport, detect the event and throw a typed error / notify `App`.
- `App` sets P2P state to failed with reauthorization guidance and clears trusted host state.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts -t "device_revoked"
npm test --workspace @coderelay/web -- src/p2pClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/p2pRuntime.ts apps/host/src/p2pRuntime.test.ts apps/web/src/p2pClient.ts apps/web/src/p2pClient.test.ts apps/web/src/App.tsx
git commit -m "feat: 撤销设备后提示重新授权"
```

---

### Task 11: Host Management Page Settings And Topology

**Files:**
- Modify: `apps/host/src/p2pRoutes.ts`
- Modify: `apps/host/src/p2pManagementPage.ts`
- Modify: `apps/host/src/p2pRuntime.ts`
- Modify: `apps/host/src/p2pRuntime.test.ts`
- Modify: `apps/host/src/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/host/src/p2pRuntime.test.ts`:

```ts
it("reports friendly devices, recent usage, configured urls and TURN topology", async () => {
  const runtime = new HostP2PRuntime({
    signalUrl: "ws://signal.test/",
    hostId: "host-test",
    webUrl: "http://web.test/",
    localApiBaseUrl: "http://127.0.0.1:3002/api",
    authToken: "test-token-123456",
    iceServers: [{ urls: "turn:relay.example.com:3478", username: "u", credential: "p" }],
    iceLocalAddresses: ["172.30.1.2"],
    trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
      clientId: "client-phone",
      clientPublicKeyJwk: { kty: "oct", k: "k" },
      displayName: "Chrome on Android",
      addedAt: "2026-06-19T00:00:00.000Z",
      lastUsedAt: "2026-06-19T00:05:00.000Z",
      lastTransport: "p2p",
    }),
    createSignalSocket: () => new FakeSignalSocket(),
    createPeerConnection: () => new FakePeerConnection(),
    createBridge: vi.fn(() => ({ close: vi.fn() })),
  });

  expect(runtime.getManagementState()).toEqual(expect.objectContaining({
    devices: [expect.objectContaining({
      displayName: "Chrome on Android",
      lastUsedAt: "2026-06-19T00:05:00.000Z",
    })],
    topology: expect.objectContaining({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      iceLocalAddresses: ["172.30.1.2"],
      turnConfigured: true,
    }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts -t "TURN topology"
```

Expected: FAIL because `turnConfigured` and configurable settings are not reported.

- [ ] **Step 3: Write minimal implementation**

- Add `turnConfigured` and `iceServers` summary to `P2PTopology`.
- Add `GET /api/host/settings` and `PATCH /api/host/settings`.
- Page form edits Web URL and Signal URL override fields.
- Page device table hides raw client ID by default and exposes it in a details row or `title`.
- Keep page dependency-free; use existing inline HTML style.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test --workspace @coderelay/host -- src/p2pRuntime.test.ts src/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/p2pRoutes.ts apps/host/src/p2pManagementPage.ts apps/host/src/p2pRuntime.ts apps/host/src/p2pRuntime.test.ts apps/host/src/app.test.ts
git commit -m "feat: 完善 Host 设备管理和链路诊断"
```

---

### Task 12: Image-Only Web UI While Preserving Upload Contract

**Files:**
- Modify: `apps/web/src/components/Composer.tsx`
- Modify: `apps/web/src/components/Composer.test.tsx`
- Modify: `apps/host/src/uploads.ts`
- Modify: `apps/host/src/uploads.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to Composer tests:

```tsx
it("only exposes image file selection in the composer", () => {
  render(<Composer disabled={false} executing={false} onSend={vi.fn()} onAbort={vi.fn()} />);

  const input = screen.getByLabelText("上传图片") as HTMLInputElement;
  expect(input.accept).toBe("image/*");
});
```

Add to uploads tests:

```ts
it("keeps the upload endpoint compatible for existing attachment refs", async () => {
  const app = express();
  app.use("/api/uploads", createUploadRouter(tempUploadsDir));

  const res = await request(app)
    .post("/api/uploads")
    .attach("file", Buffer.from("fake"), "note.txt");

  expect(res.status).toBe(200);
  expect(res.body.filename).toBe("note.txt");
});
```

- [ ] **Step 2: Run tests to verify they fail or guard current behavior**

Run:

```bash
npm test --workspace @coderelay/web -- src/components/Composer.test.tsx
npm test --workspace @coderelay/host -- src/uploads.test.ts
```

Expected: Composer test FAIL if accept is not image-only; upload compatibility test PASS and becomes a guard.

- [ ] **Step 3: Write minimal implementation**

- Change Composer file input `accept` to `image/*`.
- Change visible label to “上传图片”.
- Keep upload API untouched.
- On drag/paste non-image files, show a small inline error and skip adding them to the send list.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test --workspace @coderelay/web -- src/components/Composer.test.tsx
npm test --workspace @coderelay/host -- src/uploads.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Composer.tsx apps/web/src/components/Composer.test.tsx apps/host/src/uploads.ts apps/host/src/uploads.test.ts
git commit -m "feat: 前端上传入口收窄为图片"
```

---

### Task 13: Documentation, Scripts, CI And E2E

**Files:**
- Modify: `AGENTS.md`
- Modify: `start-host.bat`
- Modify: `start-web.bat`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/e2e/tests/browser-p2p-pairing.spec.ts`

- [ ] **Step 1: Write/update the failing E2E expectation**

In `apps/e2e/tests/browser-p2p-pairing.spec.ts`, assert:

```ts
await expect(hostPage.locator("#pairing-url")).toHaveValue(/\/pair\/[A-Z0-9]+$/);
await expect(hostPage.locator("#pairing-url")).not.toHaveValue(/p2p=/);
await expect(webPage.getByText(/协议：P2P/)).toBeVisible();
```

- [ ] **Step 2: Run E2E to verify it fails before implementation is complete**

Run:

```bash
npm test --workspace @coderelay/e2e -- browser-p2p-pairing.spec.ts
```

Expected: FAIL until short pairing and UI status are complete.

- [ ] **Step 3: Update docs and scripts**

- Add `PUBLIC_WEB_BASE_URL` and `PUBLIC_SIGNAL_URL` to `AGENTS.md`.
- Set these variables in `start-host.bat` with local defaults.
- Ensure CI runs shared, host, web, signal, transport tests.
- Document that relay means standard TURN/coturn in this phase.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run build
npm test
```

Expected: PASS.

Run E2E when browsers and local ports are available:

```bash
npm test --workspace @coderelay/e2e
```

Expected: PASS or document the exact environmental blocker.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md start-host.bat start-web.bat .github/workflows/ci.yml apps/e2e/tests/browser-p2p-pairing.spec.ts
git commit -m "docs: 更新 P2P 配置和验证说明"
```

---

## Self-Review

- Spec coverage: A1 的多订阅、先到先得、队列、模式切换、图片入口、HTTP/P2P 协议共用分别由 Task 1-7 和 Task 12 覆盖。A2 的 Host 管理页、短链二维码、友好设备名、撤销提示、TURN-only 中继和文档脚本由 Task 8-13 覆盖。
- Placeholder scan: 本计划没有未定占位项。每个任务包含测试、运行命令、实现边界和提交命令。
- Type consistency: 计划统一使用 `ClaudeSessionMode`、`SessionBus`、`prompt_already_resolved`、`device_revoked`、`pairCode`、`displayName`。
- Scope check: 不包含自研 Transit，不包含账号体系，不包含跨 Host 设备同步。
