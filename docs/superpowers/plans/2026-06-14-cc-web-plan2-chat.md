# cc-web 计划二:网页续聊(交互)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在计划一(只读浏览)之上,加上"在网页(含手机)里继续对话"的完整交互能力——续聊旧 session、新建对话、流式逐字输出、在手机上回答 Claude 的提问 / 权限确认 / 计划审批、附件与图片上传。

**Architecture:** server 用官方 `@anthropic-ai/claude-agent-sdk` 的 `query()` 启动并管理常驻 claude 会话;每个活跃会话封装为一个 `Session` 对象,持有"输入队列(喂用户消息)+ 输出泵(转发 SDK 消息)+ 待答事项登记表(挂起—推送—等待—恢复)"。前端经 SSE 接收流式消息与待答事项,经 POST 发送消息与提交答案,交互事件渲染为对话流中的卡片。

**Tech Stack:** 沿用计划一——TypeScript 全栈、Node 24 + Express、React + Vite、Vitest + supertest、npm workspaces。新增依赖:`@cc-web/server` 加 `@anthropic-ai/claude-agent-sdk`。

> 本计划对应 spec:`docs/superpowers/specs/2026-06-14-cc-web-design.md`,覆盖第 3 节(后端↔Claude 集成)、第 5 节中续聊相关端点(`continue`/`new`/`stream`/`respond`)、第 6 节中交互卡片与附件上传、第 7 节中 SDK 相关配置(`PERMISSION_MODE`/`SESSION_IDLE_TIMEOUT`/`MAX_CONCURRENT_SESSIONS`)、第 8 节中子进程相关错误处理。
>
> **前置条件:** 计划一已完成(monorepo 三包就位,`@cc-web/shared` 浏览类型、`store`/`jsonl`/`title`/`search`、`config`/`auth`/`routes`/`createApp`、前端 `api`/`App`/`Sidebar`/`Conversation`/`MessageBubble`/`Collapsible` 均已存在并通过测试)。本计划在这些已有模块上扩展。

---

## SDK 接口要点(来自 `@anthropic-ai/claude-agent-sdk@0.3.177` 真实类型定义)

实现时以下事实是代码依据,已核对类型定义文件:

- **入口:** `query({ prompt, options }): Query`,其中 `prompt: string | AsyncIterable<SDKUserMessage>`。要支持"边聊边喂",`prompt` 用 **AsyncIterable**(一个我们自己控制的异步队列)。返回的 `Query` 是 `AsyncGenerator<SDKMessage, void>`,`for await` 即可消费输出。
- **续聊:** `options.resume = sessionId`(字符串)。新建对话则不传 `resume`。
- **权限模式:** `options.permissionMode`(沿用计划一配置的 `PERMISSION_MODE`)。
- **流式逐字:** `options.includePartialMessages = true`,会额外产出 `SDKPartialAssistantMessage`(`type: "stream_event"`,内含 `event: BetaRawMessageStreamEvent`)用于逐字渲染。
- **权限回调:** `options.canUseTool: (toolName, input, { signal, toolUseID, title?, displayName?, description? }) => Promise<PermissionResult>`。返回 `{ behavior: "allow", updatedInput? }` 或 `{ behavior: "deny", message }`。我们在这里**挂起**等待手机端决策。
- **关键消息类型(`SDKMessage` 联合):**
  - `SDKAssistantMessage`(`type: "assistant"`,`message: BetaMessage`,含 `content` 块数组,块里有 `text` / `thinking` / `tool_use`)——完整助手消息。
  - `SDKPartialAssistantMessage`(`type: "stream_event"`)——逐字增量。
  - `SDKResultMessage`(`type: "result"`,`subtype: "success" | "error"`)——一轮结束,含 `is_error`、`result`。
  - `SDKSystemMessage`(`type: "system"`)、其余事件类型本计划忽略或仅记日志。
- **AskUserQuestion / ExitPlanMode:** 它们是**普通工具调用**,经 `canUseTool` 回调到达(`toolName` 为 `"AskUserQuestion"` / `"ExitPlanMode"`),`input` 里带问题/计划内容。因此"答题"和"计划审批"复用与"权限确认"相同的挂起机制,只是前端渲染成不同卡片。
- **取消:** `options.abortController`,回收会话时 `abort()`。

> **测试策略:** 绝不在自动化测试里真调 claude。我们在 Task 1 把 `query` 封装为一个可注入的 `SdkClient` 接口(`packages/server/src/sdk.ts`),测试时注入 fake 实现,驱动"挂起—推送—恢复"的事件流转。

---

## 文件结构

本计划新增/修改的文件及职责:

```
cc-web/
├── packages/
│   ├── shared/src/
│   │   ├── events.ts          # 新增:SSE 事件 + 待答事项(交互卡片)类型
│   │   └── index.ts           # 修改:重导出 events
│   ├── server/
│   │   ├── package.json       # 修改:加 @anthropic-ai/claude-agent-sdk 依赖
│   │   └── src/
│   │       ├── sdk.ts         # 新增:SdkClient 接口 + 真实 query 适配器(可注入)
│   │       ├── pending.ts     # 新增:待答事项登记表(Deferred Promise 管理)
│   │       ├── session.ts     # 新增:单个活跃会话(输入队列 + 输出泵 + 待答 + 生命周期)
│   │       ├── sessionManager.ts # 新增:会话池(创建/查找/回收、并发上限、空闲超时)
│   │       ├── sse.ts         # 新增:SSE 响应封装(写事件 / 心跳 / 关闭)
│   │       ├── chatRoutes.ts  # 新增:continue/new/stream/respond/上传 路由
│   │       ├── config.ts      # 修改:加 idleTimeoutMs / maxConcurrent / uploadsDir
│   │       └── routes.ts      # 修改:挂载 chatRoutes,注入 sessionManager
│   └── web/src/
│       ├── chatApi.ts         # 新增:发消息 / 提交答案 / 上传 的 fetch 封装
│       ├── useSession.ts      # 新增:SSE 订阅 hook(连接/重连/累积消息与待答)
│       ├── components/
│       │   ├── Composer.tsx        # 新增:输入框 + 附件/图片上传 + 发送
│       │   ├── AttachmentPreview.tsx # 新增:已选附件缩略图预览
│       │   ├── QuestionCard.tsx    # 新增:答题卡片(单/多选)
│       │   ├── PermissionCard.tsx  # 新增:权限确认卡片(允许/拒绝)
│       │   └── PlanCard.tsx        # 新增:计划审批卡片(批准/拒绝)
│       ├── Conversation.tsx   # 修改:渲染流式消息 + 在消息流中插入交互卡片
│       └── App.tsx            # 修改:接线 useSession + Composer + 新建对话
```

每个文件单一职责:`sdk` 只管"如何调 SDK"、`pending` 只管"挂起/恢复 Promise"、`session` 只管"单会话状态机"、`sessionManager` 只管"会话池与资源"、`sse` 只管"SSE 传输"、`chatRoutes` 只管"HTTP 接口"。这样会话状态机可在不起 HTTP、不调 claude 的情况下单测。

---

## 阶段 A:共享交互类型

### Task 1: SSE 事件与待答事项类型

定义贯穿前后端的交互契约:服务端经 SSE 推给前端的事件,以及三类待答事项(答题 / 权限 / 计划)的数据形状。

**Files:**
- Create: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写 `packages/shared/src/events.ts`**

```ts
// ── 待答事项:Claude 抛出、需要用户在网页上回答的三类交互 ──

/** 答题(AskUserQuestion):一个或多个问题,每题若干选项,可单选或多选 */
export interface QuestionPrompt {
  kind: "question";
  /** 待答事项 id,前端提交答案时回传 */
  id: string;
  questions: {
    header: string;
    question: string;
    multiSelect: boolean;
    options: { label: string; description: string }[];
  }[];
}

/** 权限确认(canUseTool):Claude 要执行某工具,需用户允许/拒绝 */
export interface PermissionPrompt {
  kind: "permission";
  id: string;
  toolName: string;
  /** 人类可读标题,如 "Claude wants to run npm test";来自 SDK title 或回退拼装 */
  title: string;
  /** 工具入参的可读摘要(如 Bash 命令、要改的文件路径) */
  detail: string;
}

/** 计划审批(ExitPlanMode):Claude 提交一份计划,需用户批准/拒绝 */
export interface PlanPrompt {
  kind: "plan";
  id: string;
  /** 计划正文(Markdown) */
  plan: string;
}

/** 任意一类待答事项 */
export type PendingPrompt = QuestionPrompt | PermissionPrompt | PlanPrompt;

// ── 用户对待答事项的回答 ──

/** 答题回答:与 questions 等长,每项是选中的 option label 数组(单选则长度 1) */
export interface QuestionAnswer {
  kind: "question";
  id: string;
  answers: string[][];
}

/** 权限回答 */
export interface PermissionAnswer {
  kind: "permission";
  id: string;
  decision: "allow" | "deny";
}

/** 计划回答 */
export interface PlanAnswer {
  kind: "plan";
  id: string;
  decision: "approve" | "reject";
}

export type PromptAnswer = QuestionAnswer | PermissionAnswer | PlanAnswer;

// ── SSE 事件:服务端 → 前端 ──

/** 助手逐字增量(流式) */
export interface DeltaEvent {
  type: "delta";
  /** 追加的文本片段 */
  text: string;
}

/** 一个完整的内容块到达(text / thinking / tool_use)——用于落定与折叠区块渲染 */
export interface BlockEvent {
  type: "block";
  block:
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; name: string; input: unknown; toolUseId: string };
}

/** 工具结果到达 */
export interface ToolResultEvent {
  type: "tool_result";
  toolUseId: string;
  text: string;
  isError: boolean;
}

/** 出现一个待答事项 */
export interface PromptEvent {
  type: "prompt";
  prompt: PendingPrompt;
}

/** 一轮对话结束(可继续输入) */
export interface TurnEndEvent {
  type: "turn_end";
  isError: boolean;
}

/** 会话级错误(子进程崩溃 / SDK 错误) */
export interface ErrorEvent {
  type: "error";
  message: string;
}

/** 会话被回收/关闭 */
export interface ClosedEvent {
  type: "closed";
  reason: "idle" | "aborted" | "exited";
}

export type ServerEvent =
  | DeltaEvent
  | BlockEvent
  | ToolResultEvent
  | PromptEvent
  | TurnEndEvent
  | ErrorEvent
  | ClosedEvent;

// ── REST 请求/响应(续聊相关) ──

/** POST /api/sessions/:id/continue 或 /api/sessions/new 的响应 */
export interface StartSessionResponse {
  /** 活跃会话的运行时 id(新建时由服务端生成;续聊时等于原 session id) */
  runId: string;
}

/** POST /api/sessions/:runId/message 请求体 */
export interface SendMessageRequest {
  text: string;
  /** 已上传附件的引用(服务端返回的相对路径),可空 */
  attachments?: string[];
}

/** POST /api/uploads 的响应 */
export interface UploadResponse {
  /** 服务端保存的文件引用,放进 SendMessageRequest.attachments */
  ref: string;
  filename: string;
}
```

- [ ] **Step 2: 修改 `packages/shared/src/index.ts` 重导出**

文件当前内容(计划一 Task 5)为 `export * from "./api.js";`。改为:

```ts
export * from "./api.js";
export * from "./events.js";
```

- [ ] **Step 3: 构建 shared 验证类型无误**

Run: `npm run build --workspace @cc-web/shared`
Expected: `packages/shared/dist/` 重新生成,含 `events.js`/`events.d.ts`,无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src
git commit -m "feat(shared): SSE event + interactive prompt types"
```

---

## 阶段 B:会话核心(SDK 适配器 + 待答登记表 + 状态机 + 会话池)

### Task 2: SdkClient 接口 + 真实 query 适配器

把 SDK 的 `query()` 藏在一个窄接口后面,让会话状态机依赖接口而非具体 SDK。测试注入 fake,生产注入真实适配器。

**Files:**
- Modify: `packages/server/package.json`(加依赖)
- Create: `packages/server/src/sdk.ts`

- [ ] **Step 1: 加 SDK 依赖**

修改 `packages/server/package.json`,在 `dependencies` 里加一行(保留计划一已有的 `@cc-web/shared`、`express`):

```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.177",
```

- [ ] **Step 2: 安装**

Run: `npm install`
Expected: 安装成功,`@anthropic-ai/claude-agent-sdk` 出现在 lockfile。

- [ ] **Step 3: 写 `packages/server/src/sdk.ts`**

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKUserMessage,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

/** canUseTool 回调的形态(只取我们用到的字段) */
export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  meta: { toolUseID: string; title?: string }
) => Promise<PermissionResult>;

/** 启动一次 SDK 查询所需的参数 */
export interface StartQueryParams {
  /** 异步可迭代的用户消息流(我们用输入队列驱动) */
  prompt: AsyncIterable<SDKUserMessage>;
  /** 续聊则传 session id;新建不传 */
  resume?: string;
  permissionMode: string;
  cwd?: string;
  canUseTool: CanUseToolFn;
  abortController: AbortController;
}

/** 窄接口:会话状态机只依赖它 */
export interface SdkClient {
  /** 启动查询,返回 SDK 消息的异步迭代器 */
  start(params: StartQueryParams): AsyncIterable<SDKMessage>;
}

/** 生产用的真实适配器,直接转调 SDK 的 query() */
export const realSdkClient: SdkClient = {
  start(params) {
    return query({
      prompt: params.prompt,
      options: {
        resume: params.resume,
        permissionMode: params.permissionMode as never,
        cwd: params.cwd,
        canUseTool: (toolName, input, opts) =>
          params.canUseTool(toolName, input, {
            toolUseID: opts.toolUseID,
            title: opts.title,
          }),
        includePartialMessages: true,
        abortController: params.abortController,
      },
    });
  },
};
```

> 注:`permissionMode as never` 是因为 SDK 把 `PermissionMode` 定义为字面量联合,而我们的配置是 `string`;运行期值由配置校验保证合法(计划一 `config.ts` 已限定取值,本计划 Task 9 会再校验)。

- [ ] **Step 4: 构建验证(无新测试,接口+适配器靠后续会话测试覆盖)**

Run: `npm run build --workspace @cc-web/server`
Expected: 无 TS 错误。

- [ ] **Step 5: 提交**

```bash
git add packages/server/package.json packages/server/src/sdk.ts package-lock.json
git commit -m "feat(server): injectable SdkClient wrapping agent-sdk query()"
```

---

### Task 3: 待答事项登记表(Deferred Promise 管理)

"挂起—推送—等待—恢复"的核心。当 Claude 抛出需要决策的事项时,登记一个待答项并返回一个挂起的 Promise;用户回答时按 id 解决该 Promise。

**Files:**
- Create: `packages/server/src/pending.ts`
- Test: `packages/server/src/pending.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/pending.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { PendingRegistry } from "./pending.js";

describe("PendingRegistry", () => {
  it("register returns id + promise that resolves on settle", async () => {
    const reg = new PendingRegistry();
    const { id, promise } = reg.register<string>();
    expect(typeof id).toBe("string");

    const settled = reg.settle(id, "yes");
    expect(settled).toBe(true);
    await expect(promise).resolves.toBe("yes");
  });

  it("settle on unknown id returns false", () => {
    const reg = new PendingRegistry();
    expect(reg.settle("ghost", "x")).toBe(false);
  });

  it("settle twice on same id returns false the second time", async () => {
    const reg = new PendingRegistry();
    const { id, promise } = reg.register<number>();
    expect(reg.settle(id, 1)).toBe(true);
    expect(reg.settle(id, 2)).toBe(false);
    await expect(promise).resolves.toBe(1);
  });

  it("rejectAll rejects every outstanding promise", async () => {
    const reg = new PendingRegistry();
    const a = reg.register<string>();
    const b = reg.register<string>();
    reg.rejectAll(new Error("closed"));
    await expect(a.promise).rejects.toThrow("closed");
    await expect(b.promise).rejects.toThrow("closed");
    // 拒绝后登记表应清空,旧 id settle 失败
    expect(reg.settle(a.id, "x")).toBe(false);
  });

  it("has reflects outstanding state", () => {
    const reg = new PendingRegistry();
    const { id } = reg.register<string>();
    expect(reg.has(id)).toBe(true);
    reg.settle(id, "x");
    expect(reg.has(id)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`PendingRegistry` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/pending.ts`**

```ts
import { randomUUID } from "node:crypto";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

/**
 * 待答事项登记表。register() 登记一个挂起 Promise 并返回 id;
 * settle(id, value) 解决它;rejectAll() 在会话关闭时拒绝所有未决项。
 */
export class PendingRegistry {
  private entries = new Map<string, Deferred<unknown>>();

  register<T>(): { id: string; promise: Promise<T> } {
    const id = randomUUID();
    let resolve!: (value: T) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.entries.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    return { id, promise };
  }

  settle(id: string, value: unknown): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    entry.resolve(value);
    return true;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  rejectAll(err: Error): void {
    for (const entry of this.entries.values()) {
      entry.reject(err);
    }
    this.entries.clear();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: PendingRegistry 的 5 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/pending.ts packages/server/src/pending.test.ts
git commit -m "feat(server): pending registry for suspend/resume"
```

---

### Task 4: 输入队列(把用户消息喂给 SDK 的 AsyncIterable)

SDK 的 `prompt` 需要一个 `AsyncIterable<SDKUserMessage>`。我们要能在会话存活期间随时往里 push 新消息,并在关闭时结束迭代。

**Files:**
- Create: `packages/server/src/inputQueue.ts`
- Test: `packages/server/src/inputQueue.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/inputQueue.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { InputQueue } from "./inputQueue.js";

describe("InputQueue", () => {
  it("yields pushed messages in order", async () => {
    const q = new InputQueue();
    q.push("hello");
    q.push("world");
    q.close();

    const got: string[] = [];
    for await (const msg of q) {
      // message.content 是字符串
      got.push(msg.message.content as string);
    }
    expect(got).toEqual(["hello", "world"]);
  });

  it("waits for a message pushed after iteration starts", async () => {
    const q = new InputQueue();
    const collected: string[] = [];

    const consumer = (async () => {
      for await (const msg of q) {
        collected.push(msg.message.content as string);
      }
    })();

    // 迭代已开始且在等待
    await new Promise((r) => setTimeout(r, 10));
    q.push("late");
    q.close();

    await consumer;
    expect(collected).toEqual(["late"]);
  });

  it("close ends iteration even with no messages", async () => {
    const q = new InputQueue();
    q.close();
    const got: string[] = [];
    for await (const msg of q) got.push(msg.message.content as string);
    expect(got).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`InputQueue` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/inputQueue.ts`**

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * 一个异步队列,实现 AsyncIterable<SDKUserMessage>。
 * push() 追加一条用户消息;close() 结束迭代。
 * 消费端(SDK)在队列空时挂起,直到有新消息或被关闭。
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    const msg = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: msg, done: false });
    } else {
      this.buffer.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: InputQueue 的 3 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/inputQueue.ts packages/server/src/inputQueue.test.ts
git commit -m "feat(server): async input queue feeding SDK prompt"
```

---

### Task 5: 会话状态机(Session)

把上面三块组合成单个会话:持有 `InputQueue`、`PendingRegistry`、`AbortController`,消费 SDK 输出并把每条 SDK 消息翻译成 `ServerEvent` 通过回调发出;`canUseTool` 回调把权限/答题/计划事项登记为待答并挂起。

**Files:**
- Create: `packages/server/src/session.ts`
- Test: `packages/server/src/session.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/session.test.ts`**

测试用 fake `SdkClient` 驱动各种 SDK 消息,断言翻译出的 `ServerEvent` 和"挂起—恢复"行为。

```ts
import { describe, it, expect } from "vitest";
import { Session } from "./session.js";
import type { SdkClient, StartQueryParams } from "./sdk.js";
import type { ServerEvent } from "@cc-web/shared";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** 用一个可手动投递消息的 fake SDK 客户端 */
function fakeClient(script: (params: StartQueryParams) => AsyncIterable<SDKMessage>): SdkClient {
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
        message: { role: "assistant", model: "m", content: [{ type: "text", text: "hi there" }] },
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

    expect(events).toContainEqual({ type: "block", block: { kind: "text", text: "hi there" } });
    expect(events).toContainEqual({ type: "turn_end", isError: false });
  });

  it("emits permission prompt and suspends until allowed", async () => {
    let resolveDecision: ((r: { behavior: string }) => void) | null = null;
    const client = fakeClient(async function* (params) {
      // 模拟 SDK 在执行工具前回调 canUseTool
      const decisionPromise = params.canUseTool("Bash", { command: "npm test" }, {
        toolUseID: "t1",
        title: "Claude wants to run npm test",
      });
      decisionPromise.then((r) => {
        resolveDecision?.(r as { behavior: string });
      });
      // 等决策回来后再结束
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

    // 轮询直到出现 permission prompt
    await new Promise((r) => setTimeout(r, 20));
    const promptEvent = events.find((e) => e.type === "prompt");
    expect(promptEvent).toBeDefined();
    const prompt = (promptEvent as { prompt: { kind: string; id: string; toolName: string } }).prompt;
    expect(prompt.kind).toBe("permission");
    expect(prompt.toolName).toBe("Bash");

    // 用户允许
    const ok = session.answer({ kind: "permission", id: prompt.id, decision: "allow" });
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
      // 答题被映射为 allow + updatedInput 带答案
      expect(decision.behavior).toBe("allow");
      yield {
        type: "result", subtype: "success", is_error: false, result: "",
        session_id: "s1", uuid: "r1",
      } as unknown as SDKMessage;
    });

    const { events, onEvent } = collector();
    const session = new Session({ client, permissionMode: "default", onEvent });
    session.send("ask me");
    const done = session.runToCompletion();

    await new Promise((r) => setTimeout(r, 20));
    const promptEvent = events.find((e) => e.type === "prompt");
    const prompt = (promptEvent as { prompt: { kind: string; id: string } }).prompt;
    expect(prompt.kind).toBe("question");

    session.answer({ kind: "question", id: prompt.id, answers: [["Postgres"]] });
    await done;
  });

  it("close rejects pending prompts and emits closed", async () => {
    const client = fakeClient(async function* (params) {
      // 抛出权限请求后永不返回,直到被 abort
      await params.canUseTool("Bash", { command: "sleep" }, { toolUseID: "t1" });
      yield { type: "result", subtype: "success", is_error: false, result: "", session_id: "s1", uuid: "r1" } as unknown as SDKMessage;
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`Session` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/session.ts`**

```ts
import type {
  ServerEvent,
  PromptAnswer,
  PendingPrompt,
} from "@cc-web/shared";
import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { SdkClient } from "./sdk.js";
import { InputQueue } from "./inputQueue.js";
import { PendingRegistry } from "./pending.js";

export interface SessionOptions {
  client: SdkClient;
  permissionMode: string;
  onEvent: (event: ServerEvent) => void;
  /** 续聊则传原 session id */
  resume?: string;
  cwd?: string;
}

/** canUseTool 的决策结果在内部用这个表示,再翻译成 SDK PermissionResult */
type Decision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * 单个活跃会话。持有输入队列、待答登记表、AbortController。
 * 消费 SDK 输出并翻译成 ServerEvent;canUseTool 把交互登记为待答并挂起。
 */
export class Session {
  private input = new InputQueue();
  private pending = new PendingRegistry();
  private abort = new AbortController();
  private opts: SessionOptions;
  private closed = false;

  constructor(opts: SessionOptions) {
    this.opts = opts;
  }

  /** 追加一条用户消息 */
  send(text: string): void {
    this.input.push(text);
  }

  /** 提交用户对某待答事项的回答;返回是否命中一个未决项 */
  answer(answer: PromptAnswer): boolean {
    return this.pending.settle(answer.id, answer);
  }

  /** 关闭会话:结束输入、abort SDK、拒绝未决项、发 closed 事件 */
  close(reason: "idle" | "aborted" | "exited"): void {
    if (this.closed) return;
    this.closed = true;
    this.input.close();
    this.abort.abort();
    this.pending.rejectAll(new Error("session closed"));
    this.emit({ type: "closed", reason });
  }

  private emit(event: ServerEvent): void {
    this.opts.onEvent(event);
  }

  /** 把工具调用映射为待答事项,登记并挂起,等用户回答后翻译成决策 */
  private async requestDecision(
    toolName: string,
    input: Record<string, unknown>,
    meta: { toolUseID: string; title?: string }
  ): Promise<Decision> {
    let prompt: PendingPrompt;
    const { id, promise } = this.pending.register<PromptAnswer>();

    if (toolName === "AskUserQuestion") {
      const questions = (input.questions ?? []) as PendingPrompt extends never ? never :
        { header: string; question: string; multiSelect: boolean; options: { label: string; description: string }[] }[];
      prompt = { kind: "question", id, questions };
    } else if (toolName === "ExitPlanMode") {
      prompt = { kind: "plan", id, plan: String(input.plan ?? "") };
    } else {
      prompt = {
        kind: "permission",
        id,
        toolName,
        title: meta.title ?? `Claude wants to use ${toolName}`,
        detail: summarizeInput(toolName, input),
      };
    }

    this.emit({ type: "prompt", prompt });

    const answer = await promise; // ← 挂起,直到 answer() 或 close()

    if (answer.kind === "permission") {
      return answer.decision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "User denied" };
    }
    if (answer.kind === "plan") {
      return answer.decision === "approve"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "User rejected the plan" };
    }
    // question:把答案塞回工具入参
    return { behavior: "allow", updatedInput: { ...input, _answers: answer.answers } };
  }

  /** 启动 SDK 查询并消费输出,直到一轮/多轮结束或被关闭 */
  async runToCompletion(): Promise<void> {
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      meta: { toolUseID: string; title?: string }
    ): Promise<PermissionResult> => {
      try {
        const decision = await this.requestDecision(toolName, input, meta);
        if (decision.behavior === "allow") {
          return { behavior: "allow", updatedInput: decision.updatedInput ?? input };
        }
        return { behavior: "deny", message: decision.message };
      } catch {
        // 会话关闭导致 reject
        return { behavior: "deny", message: "session closed" };
      }
    };

    try {
      const stream = this.opts.client.start({
        prompt: this.input,
        resume: this.opts.resume,
        permissionMode: this.opts.permissionMode,
        cwd: this.opts.cwd,
        canUseTool,
        abortController: this.abort,
      });

      for await (const msg of stream) {
        if (this.closed) break;
        this.handleSdkMessage(msg);
      }
    } catch (err) {
      if (!this.closed) {
        this.emit({ type: "error", message: (err as Error).message });
      }
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case "stream_event": {
        // 逐字增量:从 content_block_delta 取 text
        const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          this.emit({ type: "delta", text: ev.delta.text });
        }
        break;
      }
      case "assistant": {
        const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const block of content as { type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string }[]) {
          if (block.type === "text") {
            this.emit({ type: "block", block: { kind: "text", text: block.text ?? "" } });
          } else if (block.type === "thinking") {
            this.emit({ type: "block", block: { kind: "thinking", text: block.thinking ?? "" } });
          } else if (block.type === "tool_use") {
            this.emit({
              type: "block",
              block: { kind: "tool_use", name: block.name ?? "", input: block.input, toolUseId: block.id ?? "" },
            });
          }
        }
        break;
      }
      case "result": {
        const isError = (msg as { is_error?: boolean }).is_error ?? false;
        this.emit({ type: "turn_end", isError });
        break;
      }
      default:
        // 其余 SDK 消息类型本计划忽略
        break;
    }
  }
}

/** 把工具入参压成一行可读摘要,给权限卡片显示 */
function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  try {
    return JSON.stringify(input).slice(0, 200);
  } catch {
    return toolName;
  }
}
```

> 关于 `requestDecision` 里 `questions` 的类型:运行期它来自 SDK 的 `AskUserQuestion` 入参,形状与 `QuestionPrompt.questions` 一致。实现时直接断言为该类型即可(`input.questions as QuestionPrompt["questions"]`),上面的写法为可读性展开了;落地时用 `import type { QuestionPrompt } from "@cc-web/shared"` 并写 `const questions = (input.questions ?? []) as QuestionPrompt["questions"];`。

- [ ] **Step 4: 修正 questions 类型(落地实现的精确写法)**

`packages/server/src/session.ts` 顶部 import 改为含 `QuestionPrompt`:

```ts
import type {
  ServerEvent,
  PromptAnswer,
  PendingPrompt,
  QuestionPrompt,
} from "@cc-web/shared";
```

`requestDecision` 里 AskUserQuestion 分支改为:

```ts
    if (toolName === "AskUserQuestion") {
      const questions = (input.questions ?? []) as QuestionPrompt["questions"];
      prompt = { kind: "question", id, questions };
    } else if (toolName === "ExitPlanMode") {
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: Session 的 4 个测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/server/src/session.ts packages/server/src/session.test.ts
git commit -m "feat(server): session state machine (suspend/push/resume)"
```

---

### Task 6: 会话池(SessionManager)

管理活跃会话:创建(续聊/新建)、按 runId 查找、并发上限、空闲超时回收。

**Files:**
- Create: `packages/server/src/sessionManager.ts`
- Test: `packages/server/src/sessionManager.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/sessionManager.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "./sessionManager.js";
import type { SdkClient } from "./sdk.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** 一个永不自行结束的 fake SDK(便于测并发/超时) */
const idleClient: SdkClient = {
  start: async function* () {
    await new Promise(() => {}); // 永不 resolve
    yield {} as SDKMessage;
  },
};

function makeManager(overrides: Partial<{ maxConcurrent: number; idleTimeoutMs: number }> = {}) {
  return new SessionManager({
    client: idleClient,
    permissionMode: "default",
    maxConcurrent: overrides.maxConcurrent ?? 5,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 60_000,
  });
}

describe("SessionManager", () => {
  it("creates a new session and returns a runId", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => {});
    expect(typeof runId).toBe("string");
    expect(mgr.get(runId)).toBeDefined();
  });

  it("continue uses the given session id as runId", () => {
    const mgr = makeManager();
    const runId = mgr.startContinue("existing-session", () => {});
    expect(runId).toBe("existing-session");
  });

  it("throws when exceeding max concurrent sessions", () => {
    const mgr = makeManager({ maxConcurrent: 1 });
    mgr.startNew(() => {});
    expect(() => mgr.startNew(() => {})).toThrow(/max/i);
  });

  it("close removes the session from the pool", () => {
    const mgr = makeManager();
    const runId = mgr.startNew(() => {});
    mgr.close(runId, "aborted");
    expect(mgr.get(runId)).toBeUndefined();
  });

  it("idle timeout closes the session", async () => {
    vi.useFakeTimers();
    const mgr = makeManager({ idleTimeoutMs: 1000 });
    const runId = mgr.startNew(() => {});
    expect(mgr.get(runId)).toBeDefined();
    vi.advanceTimersByTime(1001);
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });

  it("touch resets the idle timer", async () => {
    vi.useFakeTimers();
    const mgr = makeManager({ idleTimeoutMs: 1000 });
    const runId = mgr.startNew(() => {});
    vi.advanceTimersByTime(800);
    mgr.touch(runId);
    vi.advanceTimersByTime(800); // 距上次 touch 仅 800ms
    expect(mgr.get(runId)).toBeDefined();
    vi.advanceTimersByTime(300); // 累计超过 1000ms
    expect(mgr.get(runId)).toBeUndefined();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`SessionManager` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/sessionManager.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { ServerEvent } from "@cc-web/shared";
import type { SdkClient } from "./sdk.js";
import { Session } from "./session.js";

export interface SessionManagerOptions {
  client: SdkClient;
  permissionMode: string;
  maxConcurrent: number;
  idleTimeoutMs: number;
  cwd?: string;
}

interface Entry {
  session: Session;
  timer: NodeJS.Timeout;
}

/** 活跃会话池:创建/查找/回收,带并发上限与空闲超时。 */
export class SessionManager {
  private entries = new Map<string, Entry>();
  private opts: SessionManagerOptions;

  constructor(opts: SessionManagerOptions) {
    this.opts = opts;
  }

  private create(runId: string, resume: string | undefined, onEvent: (e: ServerEvent) => void): string {
    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(`max concurrent sessions (${this.opts.maxConcurrent}) reached`);
    }
    const session = new Session({
      client: this.opts.client,
      permissionMode: this.opts.permissionMode,
      cwd: this.opts.cwd,
      resume,
      onEvent,
    });
    const timer = this.armTimer(runId);
    this.entries.set(runId, { session, timer });
    // 后台跑,结束后自动清理
    void session.runToCompletion().finally(() => this.close(runId, "exited"));
    return runId;
  }

  startNew(onEvent: (e: ServerEvent) => void): string {
    return this.create(randomUUID(), undefined, onEvent);
  }

  startContinue(sessionId: string, onEvent: (e: ServerEvent) => void): string {
    return this.create(sessionId, sessionId, onEvent);
  }

  get(runId: string): Session | undefined {
    return this.entries.get(runId)?.session;
  }

  /** 重置空闲计时器(有活动时调用) */
  touch(runId: string): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = this.armTimer(runId);
  }

  close(runId: string, reason: "idle" | "aborted" | "exited"): void {
    const entry = this.entries.get(runId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(runId);
    entry.session.close(reason);
  }

  private armTimer(runId: string): NodeJS.Timeout {
    return setTimeout(() => this.close(runId, "idle"), this.opts.idleTimeoutMs);
  }
}
```

> 注:`create` 里 `void session.runToCompletion().finally(...)` 会在会话自然结束(或出错)后调用 `close(runId, "exited")`。`close` 对已删除的 runId 是幂等的(`get` 返回 undefined 直接 return),所以与 idle/aborted 路径不冲突。测试里 `idleClient` 永不结束,因此 `finally` 不会过早触发。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: SessionManager 的 6 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/sessionManager.ts packages/server/src/sessionManager.test.ts
git commit -m "feat(server): session pool with concurrency cap + idle timeout"
```

---

## 阶段 C:传输与路由(SSE + 续聊/新建/流式/答题/上传)

### Task 7: SSE 响应封装

把 Express 的 `Response` 包成一个只暴露"写一个 `ServerEvent` / 心跳 / 关闭"的小对象,便于路由层使用,也便于单测。

**Files:**
- Create: `packages/server/src/sse.ts`
- Test: `packages/server/src/sse.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/sse.test.ts`**

用一个 fake `Response`(只实现 `write`/`writeHead`/`on`/`end`)断言写出的 SSE 帧格式。

```ts
import { describe, it, expect, vi } from "vitest";
import { SseChannel } from "./sse.js";
import type { ServerEvent } from "@cc-web/shared";

/** 最小 fake Express Response */
function fakeRes() {
  const chunks: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    headersSent: false,
    writeHead: vi.fn(),
    write: vi.fn((s: string) => { chunks.push(s); return true; }),
    end: vi.fn(),
    on: vi.fn((ev: string, cb: () => void) => { handlers[ev] = cb; }),
    flushHeaders: vi.fn(),
    chunks,
    handlers,
  };
}

describe("SseChannel", () => {
  it("writes an event as 'data: <json>\\n\\n'", () => {
    const res = fakeRes();
    const ch = new SseChannel(res as never);
    const event: ServerEvent = { type: "delta", text: "hi" };
    ch.send(event);
    expect(res.chunks.join("")).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("sets SSE headers on construction", () => {
    const res = fakeRes();
    new SseChannel(res as never);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" })
    );
  });

  it("heartbeat writes a comment line", () => {
    const res = fakeRes();
    const ch = new SseChannel(res as never);
    ch.heartbeat();
    expect(res.chunks.join("")).toBe(`: ping\n\n`);
  });

  it("invokes onClose when the client disconnects", () => {
    const res = fakeRes();
    const onClose = vi.fn();
    const ch = new SseChannel(res as never);
    ch.onClose(onClose);
    // 模拟客户端断开
    res.handlers["close"]?.();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`SseChannel` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/sse.ts`**

```ts
import type { Response } from "express";
import type { ServerEvent } from "@cc-web/shared";

/** 把一个 Express Response 包成 SSE 通道。 */
export class SseChannel {
  private res: Response;

  constructor(res: Response) {
    this.res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // 立即刷出头,前端 EventSource 才会进入 open
    res.flushHeaders?.();
  }

  send(event: ServerEvent): void {
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /** 注释行心跳,保持连接不被代理掐断 */
  heartbeat(): void {
    this.res.write(`: ping\n\n`);
  }

  onClose(cb: () => void): void {
    this.res.on("close", cb);
  }

  end(): void {
    this.res.end();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: SseChannel 的 4 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/sse.ts packages/server/src/sse.test.ts
git commit -m "feat(server): SSE channel wrapper"
```

---

### Task 8: 续聊路由扩展配置

计划一的 `config.ts` 已有 `authToken`/`port`/`projectsDir`/`permissionMode`。本任务补上 SDK 会话相关的三项:空闲超时、并发上限、上传目录。

**Files:**
- Modify: `packages/server/src/config.ts`
- Test: `packages/server/src/config.test.ts`(计划一已存在,追加用例)

- [ ] **Step 1: 追加失败测试到 `packages/server/src/config.test.ts`**

在文件末尾的 `describe("loadConfig", ...)` 内追加(若计划一用的是别的组织方式,放进同一 describe 即可):

```ts
  it("parses session knobs with defaults", () => {
    const cfg = loadConfig({ AUTH_TOKEN: "t" });
    expect(cfg.idleTimeoutMs).toBe(30 * 60 * 1000); // 30m
    expect(cfg.maxConcurrent).toBe(4);
    expect(cfg.uploadsDir).toMatch(/uploads$/);
  });

  it("overrides session knobs from env", () => {
    const cfg = loadConfig({
      AUTH_TOKEN: "t",
      SESSION_IDLE_TIMEOUT_MS: "5000",
      MAX_CONCURRENT_SESSIONS: "2",
      UPLOADS_DIR: "/tmp/up",
    });
    expect(cfg.idleTimeoutMs).toBe(5000);
    expect(cfg.maxConcurrent).toBe(2);
    expect(cfg.uploadsDir).toBe("/tmp/up");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`idleTimeoutMs`/`maxConcurrent`/`uploadsDir` 未定义。

- [ ] **Step 3: 修改 `packages/server/src/config.ts`**

在 `Config` 接口里追加三个字段(保留计划一已有字段):

```ts
export interface Config {
  authToken: string;
  port: number;
  projectsDir: string;
  permissionMode: string;
  // ── 计划二新增 ──
  idleTimeoutMs: number;
  maxConcurrent: number;
  uploadsDir: string;
}
```

在 `loadConfig` 的 return 对象里追加(保留计划一已有字段的解析逻辑):

```ts
  const idleTimeoutMs = env.SESSION_IDLE_TIMEOUT_MS
    ? Number(env.SESSION_IDLE_TIMEOUT_MS)
    : 30 * 60 * 1000;
  const maxConcurrent = env.MAX_CONCURRENT_SESSIONS
    ? Number(env.MAX_CONCURRENT_SESSIONS)
    : 4;
  const uploadsDir = env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
```

并把它们加入 return:

```ts
  return {
    authToken,
    port,
    projectsDir,
    permissionMode,
    idleTimeoutMs,
    maxConcurrent,
    uploadsDir,
  };
```

> 若计划一的 `config.ts` 顶部未 import `join`,补一行:`import { join } from "node:path";`

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: config 的新增 2 个用例 + 计划一原有用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/config.ts packages/server/src/config.test.ts
git commit -m "feat(server): config knobs for idle timeout / concurrency / uploads"
```

---

### Task 9: 文件上传路由

接收附件/图片,存到 `uploadsDir`,返回引用。用 `multer` 处理 multipart。

**Files:**
- Modify: `packages/server/package.json`(加 `multer`)
- Create: `packages/server/src/uploads.ts`
- Test: `packages/server/src/uploads.test.ts`

- [ ] **Step 1: 加依赖**

修改 `packages/server/package.json`,`dependencies` 加 `multer`,`devDependencies` 加其类型:

```json
    "multer": "^1.4.5-lts.1",
```
```json
    "@types/multer": "^1.4.12",
```

- [ ] **Step 2: 安装**

Run: `npm install`
Expected: 安装成功。

- [ ] **Step 3: 写失败测试 `packages/server/src/uploads.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUploadRouter } from "./uploads.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cc-web-up-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function app() {
  const a = express();
  a.use("/api/uploads", createUploadRouter(dir));
  return a;
}

describe("upload router", () => {
  it("stores an uploaded file and returns a ref", async () => {
    const res = await request(app())
      .post("/api/uploads")
      .attach("file", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("note.txt");
    expect(typeof res.body.ref).toBe("string");
    expect(existsSync(join(dir, res.body.ref))).toBe(true);
  });

  it("rejects a request with no file", async () => {
    const res = await request(app()).post("/api/uploads");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`createUploadRouter` 未定义。

- [ ] **Step 5: 实现 `packages/server/src/uploads.ts`**

```ts
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { UploadResponse } from "@cc-web/shared";

/** 创建上传路由,文件存到 destDir,引用是随机文件名(保留扩展名)。 */
export function createUploadRouter(destDir: string): Router {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
  });
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

  const router = Router();
  router.post("/", upload.single("file"), (req, res) => {
    const file = (req as { file?: { filename: string; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "no file" });
      return;
    }
    const body: UploadResponse = { ref: file.filename, filename: file.originalname };
    res.json(body);
  });
  return router;
}
```

> 上传目录需存在。Task 12 的入口会在启动时 `mkdirSync(uploadsDir, { recursive: true })`。测试里用的是临时目录,已存在。

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: upload 的 2 个测试 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/server/src/uploads.ts packages/server/src/uploads.test.ts packages/server/package.json package-lock.json
git commit -m "feat(server): file upload route"
```

---

### Task 10: 续聊/新建/流式/答题路由

把 `SessionManager` 接到 HTTP:新建/续聊创建会话,SSE 订阅会话事件,POST 发消息与提交答案。

**Files:**
- Create: `packages/server/src/chatRoutes.ts`
- Test: `packages/server/src/chatRoutes.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/chatRoutes.test.ts`**

用 fake `SdkClient` 注入 `SessionManager`,经 supertest 驱动整条 HTTP 链路:新建会话 → 发消息 → SSE 收到 block/turn_end。

```ts
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
        message: { role: "assistant", model: "m", content: [{ type: "text", text: "pong" }] },
        parent_tool_use_id: null, uuid: "u1", session_id: "s1",
      } as unknown as SDKMessage;
      yield {
        type: "result", subtype: "success", is_error: false, result: "pong",
        session_id: "s1", uuid: "r1",
      } as unknown as SDKMessage;
      break;
    }
  },
};

function app() {
  const mgr = new SessionManager({
    client: echoClient, permissionMode: "default", maxConcurrent: 4, idleTimeoutMs: 60_000,
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

    // 先发消息(SDK 的 echoClient 会在收到消息后产出 pong)
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

    expect(res.text ?? (res.body as string)).toContain(`"type":"block"`);
    expect(res.text ?? (res.body as string)).toContain(`"type":"turn_end"`);
  });
});
```

> 注:SSE 在测试里要"读到某事件就主动断开",上面用 supertest 的自定义 `parse` 实现。若该写法在环境里不稳定,可退化为:给 `SseChannel` 暴露一个 `replay` 缓冲(会话产生的事件先入队,SSE 连接建立后先回放队列),测试直接断言队列。实现见 Step 3 的事件缓冲设计。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`createChatRouter` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/chatRoutes.ts`**

会话产生的事件要在"SSE 尚未连接"时也不丢,所以 `SessionManager` 侧给每个会话挂一个事件缓冲 + 当前 SSE 通道。这里在路由层用一个轻量 `Hub` 实现回放。

```ts
import { Router } from "express";
import type { ServerEvent, PromptAnswer, SendMessageRequest, StartSessionResponse } from "@cc-web/shared";
import type { SessionManager } from "./sessionManager.js";
import { SseChannel } from "./sse.js";

/** 每个 runId 的事件缓冲 + 可选当前 SSE 通道 */
interface Hub {
  buffer: ServerEvent[];
  channel: SseChannel | null;
}

export function createChatRouter(mgr: SessionManager): Router {
  const hubs = new Map<string, Hub>();

  function hubFor(runId: string): Hub {
    let hub = hubs.get(runId);
    if (!hub) {
      hub = { buffer: [], channel: null };
      hubs.set(runId, hub);
    }
    return hub;
  }

  /** 会话事件回调:有 SSE 连着就直接推,否则缓冲等连接回放 */
  function makeOnEvent(runId: string) {
    return (event: ServerEvent) => {
      const hub = hubFor(runId);
      if (hub.channel) {
        hub.channel.send(event);
      } else {
        hub.buffer.push(event);
      }
      if (event.type === "closed") {
        hubs.delete(runId);
      }
    };
  }

  const router = Router();

  // 新建对话
  router.post("/sessions/new", (_req, res) => {
    const runId = mgr.startNew(makeOnEvent(crypto.randomUUID())); // 占位,见下方修正
    const body: StartSessionResponse = { runId };
    res.json(body);
  });

  // 续聊
  router.post("/sessions/:id/continue", (req, res) => {
    const sessionId = req.params.id;
    const runId = mgr.startContinue(sessionId, makeOnEvent(sessionId));
    const body: StartSessionResponse = { runId };
    res.json(body);
  });

  // 发消息
  router.post("/sessions/:runId/message", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const { text } = req.body as SendMessageRequest;
    session.send(text);
    mgr.touch(runId);
    res.json({ ok: true });
  });

  // 提交答案(权限/答题/计划)
  router.post("/sessions/:runId/respond", (req, res) => {
    const runId = req.params.runId;
    const session = mgr.get(runId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const answer = req.body as PromptAnswer;
    const ok = session.answer(answer);
    mgr.touch(runId);
    res.json({ ok });
  });

  // SSE 订阅
  router.get("/sessions/:runId/stream", (req, res) => {
    const runId = req.params.runId;
    if (!mgr.get(runId)) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const hub = hubFor(runId);
    const channel = new SseChannel(res);
    hub.channel = channel;
    // 回放缓冲
    for (const event of hub.buffer) channel.send(event);
    hub.buffer = [];

    const heartbeat = setInterval(() => channel.heartbeat(), 15_000);
    channel.onClose(() => {
      clearInterval(heartbeat);
      if (hub.channel === channel) hub.channel = null;
    });
  });

  return router;
}
```

> **Step 3 修正(runId 与 hub 对齐):** `POST /sessions/new` 里 `makeOnEvent` 的 runId 必须等于 `startNew` 返回的 runId,但 runId 是 `startNew` 内部生成的——存在先后依赖。改为让 `SessionManager.startNew` 接受"用 runId 构造回调"的工厂。修改两处:

- [ ] **Step 4: 调整 `SessionManager` 接受回调工厂**

修改 `packages/server/src/sessionManager.ts` 的 `startNew`/`startContinue`/`create`,把"直接收 onEvent"改为"收一个 `(runId) => onEvent` 工厂",这样回调能拿到最终 runId:

```ts
  private create(
    runId: string,
    resume: string | undefined,
    onEventFor: (runId: string) => (e: ServerEvent) => void
  ): string {
    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(`max concurrent sessions (${this.opts.maxConcurrent}) reached`);
    }
    const session = new Session({
      client: this.opts.client,
      permissionMode: this.opts.permissionMode,
      cwd: this.opts.cwd,
      resume,
      onEvent: onEventFor(runId),
    });
    const timer = this.armTimer(runId);
    this.entries.set(runId, { session, timer });
    void session.runToCompletion().finally(() => this.close(runId, "exited"));
    return runId;
  }

  startNew(onEventFor: (runId: string) => (e: ServerEvent) => void): string {
    return this.create(randomUUID(), undefined, onEventFor);
  }

  startContinue(sessionId: string, onEventFor: (runId: string) => (e: ServerEvent) => void): string {
    return this.create(sessionId, sessionId, onEventFor);
  }
```

> 这会改变 Task 6 测试里 `startNew(() => {})` 的调用形态。同步修改 `sessionManager.test.ts`:把 `mgr.startNew(() => {})` 改为 `mgr.startNew(() => () => {})`,`mgr.startContinue("existing-session", () => {})` 改为 `mgr.startContinue("existing-session", () => () => {})`。改完重跑 Task 6 测试应仍 PASS。

- [ ] **Step 5: 对齐 `chatRoutes.ts` 用工厂**

把 `chatRoutes.ts` 里两处 start 改为传工厂,删掉占位的 `crypto.randomUUID()`:

```ts
  // 新建对话
  router.post("/sessions/new", (_req, res) => {
    const runId = mgr.startNew((id) => makeOnEvent(id));
    const body: StartSessionResponse = { runId };
    res.json(body);
  });

  // 续聊
  router.post("/sessions/:id/continue", (req, res) => {
    const sessionId = req.params.id;
    const runId = mgr.startContinue(sessionId, (id) => makeOnEvent(id));
    const body: StartSessionResponse = { runId };
    res.json(body);
  });
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: chatRoutes 的 3 个测试 + 调整后的 sessionManager 6 个测试全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/server/src/chatRoutes.ts packages/server/src/chatRoutes.test.ts packages/server/src/sessionManager.ts packages/server/src/sessionManager.test.ts
git commit -m "feat(server): chat routes (new/continue/message/respond/stream) with event replay"
```

---

### Task 11: 把 chatRoutes + uploads 挂载进 app,鉴权前置

计划一的 `routes.ts`/`createApp` 已组装浏览路由与鉴权中间件。本任务在其基础上挂载续聊路由与上传路由(同样前置鉴权),并注入 `SessionManager`。

**Files:**
- Modify: `packages/server/src/routes.ts`
- Test: `packages/server/src/routes.test.ts`(计划一已存在,追加用例)

- [ ] **Step 1: 追加失败测试到 `packages/server/src/routes.test.ts`**

断言续聊端点也受鉴权保护(无 token → 401),带 token → 命中路由(404/200 而非 401)。

```ts
  it("chat routes require auth", async () => {
    const app = createApp({
      ...baseConfig, // 计划一测试里已有的基础 config(含 authToken)
    });
    const res = await request(app).post("/api/sessions/new").send({});
    expect(res.status).toBe(401);
  });

  it("chat routes reachable with valid token", async () => {
    const app = createApp({ ...baseConfig });
    const res = await request(app)
      .post("/api/sessions/new")
      .set("Authorization", `Bearer ${baseConfig.authToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.runId).toBe("string");
  });
```

> `baseConfig` 是计划一 routes.test 里用于构造 app 的配置对象。若计划一用的变量名不同,沿用其既有名字。注:`createApp` 默认会用 `realSdkClient` 启动真实 SDK,但 `POST /sessions/new` 只是创建会话对象、不会立即调用模型(模型在收到第一条 message 时才动),所以该测试不会真起 claude。为稳妥,Step 3 让 `createApp` 接受可选的 `sdkClient` 注入,测试传 fake。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,续聊路由未挂载(404 或方法不存在)。

- [ ] **Step 3: 修改 `packages/server/src/routes.ts`**

`createApp` 增加可选第二参数注入 `SdkClient`(默认真实适配器),内部构造 `SessionManager` 并挂载 chat/upload 路由。保留计划一已有的浏览路由与鉴权中间件装配。

```ts
import express from "express";
import { mkdirSync } from "node:fs";
import type { Config } from "./config.js";
import { realSdkClient, type SdkClient } from "./sdk.js";
import { SessionManager } from "./sessionManager.js";
import { createChatRouter } from "./chatRoutes.js";
import { createUploadRouter } from "./uploads.js";
// ↓ 计划一已有的 import:requireAuth、浏览路由组装函数等

export function createApp(config: Config, sdkClient: SdkClient = realSdkClient) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // ── 鉴权:/api/auth 放行,其余 /api 前置鉴权(计划一已实现 requireAuth/authRoute) ──
  // app.post("/api/auth", ...)           // 计划一
  // app.use("/api", requireAuth(config)) // 计划一

  // ── 浏览路由(计划一已挂载):projects / sessions / search ──
  // app.use("/api", createBrowseRouter(config))  // 计划一

  // ── 计划二:续聊 + 上传 ──
  mkdirSync(config.uploadsDir, { recursive: true });
  const manager = new SessionManager({
    client: sdkClient,
    permissionMode: config.permissionMode,
    maxConcurrent: config.maxConcurrent,
    idleTimeoutMs: config.idleTimeoutMs,
    cwd: config.projectsDir, // 注:cwd 影响 claude 工作目录,部署时按需调整
  });
  app.use("/api", createChatRouter(manager));
  app.use("/api/uploads", createUploadRouter(config.uploadsDir));

  return app;
}
```

> **接线顺序要点:** `app.use("/api", requireAuth)` 必须在 chat/upload 路由**之前**,确保它们受保护;`/api/auth` 登录端点在 `requireAuth` 之前注册。以上注释标注了计划一已有部分的相对位置——实现时把计划二的新增块插入到计划一浏览路由之后即可,不要重复注册鉴权。

> 测试注入:routes.test 里把上面新增的两个用例改成 `createApp(baseConfig, fakeSdkClient)`,fakeSdkClient 用 Task 10 的 `echoClient` 或一个 idle client,避免真起 SDK。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: routes 的新增 2 个用例 + 计划一原有用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes.ts packages/server/src/routes.test.ts
git commit -m "feat(server): mount chat + upload routes behind auth"
```

---

### Task 12: server 入口注入上传目录创建

计划一的 `index.ts` 已加载配置并 `createApp(config).listen(port)`。`createApp` 内部已 `mkdirSync(uploadsDir)`(Task 11),因此入口无需额外改动。本任务仅验证端到端启动不报错。

**Files:**
- (无新文件;如计划一入口对 `createApp` 的调用签名是 `createApp(config)`,无需改动——第二参数有默认值)

- [ ] **Step 1: 构建并冒烟启动**

Run: `npm run build --workspace @cc-web/server`
Expected: 无 TS 错误。

- [ ] **Step 2: 冒烟启动(需要本机已登录 claude)**

Run: `AUTH_TOKEN=dev node packages/server/dist/index.js`
Expected: 打印监听端口,无崩溃。Ctrl-C 退出。

> 此步无提交(仅验证)。

---

## 阶段 D:前端交互(SSE 订阅 + 输入 + 交互卡片 + 对话流接线)

### Task 13: 续聊 API 封装(发消息 / 提交答案 / 上传)

复用计划一的 `api.ts`(带 token 的 fetch 封装)。本任务新增续聊专用调用。

**Files:**
- Create: `packages/web/src/chatApi.ts`

- [ ] **Step 1: 写 `packages/web/src/chatApi.ts`**

```ts
import type {
  StartSessionResponse,
  SendMessageRequest,
  PromptAnswer,
  UploadResponse,
} from "@cc-web/shared";
import { authHeaders } from "./api.js"; // 计划一导出的"带 token 的 header 工厂"

/** 新建对话,返回 runId */
export async function startNew(): Promise<string> {
  const res = await fetch("/api/sessions/new", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`startNew failed: ${res.status}`);
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 续聊已有 session,返回 runId */
export async function startContinue(sessionId: string): Promise<string> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/continue`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`startContinue failed: ${res.status}`);
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 发一条用户消息 */
export async function sendMessage(runId: string, req: SendMessageRequest): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/message`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`);
}

/** 提交对待答事项的回答 */
export async function respond(runId: string, answer: PromptAnswer): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/respond`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
  if (!res.ok) throw new Error(`respond failed: ${res.status}`);
}

/** 上传一个文件,返回引用 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { ...authHeaders() }, // 不要手动设 Content-Type,浏览器会带 boundary
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()) as UploadResponse;
}
```

> 若计划一的 `api.ts` 暴露的是别的形式(例如直接返回完整 header 的 `authHeaders()` 或一个 `apiFetch` 包装),沿用其既有导出名;此处假设有 `authHeaders(): Record<string,string>`。如果计划一只存了 token 到 `localStorage`,则在本文件顶部加:`function authHeaders() { const t = localStorage.getItem("cc-web-token"); return t ? { Authorization: \`Bearer ${t}\` } : {}; }`,并不再 import。

- [ ] **Step 2: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/chatApi.ts
git commit -m "feat(web): chat api wrappers (message/respond/upload)"
```

---

### Task 14: SSE 订阅 hook(useSession)

一个 React hook:连上 `/api/sessions/:runId/stream`,把 `ServerEvent` 累积成"流式消息列表 + 当前待答事项",并暴露断线重连。

**Files:**
- Create: `packages/web/src/useSession.ts`

- [ ] **Step 1: 写 `packages/web/src/useSession.ts`**

EventSource 不支持自定义 header,token 经查询参数传(后端鉴权中间件需同时接受 `?token=`;见下方说明)。

```ts
import { useEffect, useRef, useState, useCallback } from "react";
import type { ServerEvent, PendingPrompt } from "@cc-web/shared";

/** 前端侧的一条流式消息 */
export interface LiveMessage {
  role: "assistant";
  /** 已落定的块 */
  blocks: (
    | { kind: "text"; text: string }
    | { kind: "thinking"; text: string }
    | { kind: "tool_use"; name: string; input: unknown; toolUseId: string }
    | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  )[];
  /** 正在流式累积、尚未落定的文本 */
  streaming: string;
}

export interface SessionState {
  messages: LiveMessage[];
  pending: PendingPrompt | null;
  connected: boolean;
  error: string | null;
}

function tokenParam(): string {
  const t = localStorage.getItem("cc-web-token");
  return t ? `?token=${encodeURIComponent(t)}` : "";
}

/** 订阅一个活跃会话的 SSE 流 */
export function useSession(runId: string | null): SessionState {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const apply = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "delta":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last || last.streaming === "" && last.blocks.length > 0 && false) {
            // no-op placeholder; 实际逻辑见下
          }
          if (!last) {
            last = { role: "assistant", blocks: [], streaming: "" };
            next.push(last);
          } else {
            last = { ...last };
            next[next.length - 1] = last;
          }
          last.streaming += event.text;
          return next;
        });
        break;
      case "block":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last) {
            last = { role: "assistant", blocks: [], streaming: "" };
            next.push(last);
          } else {
            last = { ...last, blocks: [...last.blocks] };
            next[next.length - 1] = last;
          }
          // 文本块落定时清空 streaming(它就是这块的最终文本)
          if (event.block.kind === "text") last.streaming = "";
          last.blocks.push(event.block);
          return next;
        });
        break;
      case "tool_result":
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            const copy = { ...last, blocks: [...last.blocks] };
            copy.blocks.push({
              kind: "tool_result",
              toolUseId: event.toolUseId,
              text: event.text,
              isError: event.isError,
            });
            next[next.length - 1] = copy;
          }
          return next;
        });
        break;
      case "prompt":
        setPending(event.prompt);
        break;
      case "turn_end":
        setPending(null);
        // 一轮结束:开一条新的空消息容器,下一轮 assistant 输出进新气泡
        setMessages((prev) => [...prev, { role: "assistant", blocks: [], streaming: "" }]);
        break;
      case "error":
        setError(event.message);
        break;
      case "closed":
        setConnected(false);
        break;
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled || !runId) return;
      const es = new EventSource(`/api/sessions/${encodeURIComponent(runId)}/stream${tokenParam()}`);
      esRef.current = es;
      es.onopen = () => { setConnected(true); setError(null); };
      es.onmessage = (e) => {
        try { apply(JSON.parse(e.data) as ServerEvent); } catch { /* 忽略心跳/坏帧 */ }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        // 自动重连
        retry = setTimeout(connect, 2000);
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [runId, apply]);

  return { messages, pending, connected, error };
}
```

> **后端配合(鉴权接受查询参数 token):** EventSource 无法设 `Authorization` 头,所以 SSE 连接用 `?token=`。需在计划一的 `requireAuth` 中间件里增加:除了读 `Authorization: Bearer`,也读 `req.query.token`。这是对计划一 `auth.ts` 的一处小修改 —— 见 Task 15。

> 上面 `delta` 分支里那段 `if (... && false)` 是笔误残留,落地时删掉该死代码,只保留"取/建 last → 复制 → 追加 streaming"的逻辑。修正写法见 Task 14b。

- [ ] **Step 2(Task 14b):修正 delta 分支为干净实现**

把 `useSession.ts` 里 `case "delta":` 整段替换为:

```ts
      case "delta":
        setMessages((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          if (!last) {
            last = { role: "assistant", blocks: [], streaming: "" };
            next.push(last);
          } else {
            last = { ...last };
            next[next.length - 1] = last;
          }
          last.streaming += event.text;
          return next;
        });
        break;
```

- [ ] **Step 3: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误(确认死代码已删)。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/useSession.ts
git commit -m "feat(web): useSession SSE hook (stream accumulation + reconnect)"
```

---

### Task 15: 后端鉴权接受查询参数 token(配合 SSE)

`EventSource` 不能带 `Authorization` 头,所以 SSE 路由要支持 `?token=`。这是对计划一 `auth.ts` 的小修改。

**Files:**
- Modify: `packages/server/src/auth.ts`
- Test: `packages/server/src/auth.test.ts`(计划一已存在,追加用例)

- [ ] **Step 1: 追加失败测试到 `packages/server/src/auth.test.ts`**

```ts
  it("accepts token from query param (for SSE)", async () => {
    const app = express();
    app.use("/api", requireAuth({ authToken: "secret" } as never));
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));

    const ok = await request(app).get("/api/ping?token=secret");
    expect(ok.status).toBe(200);

    const bad = await request(app).get("/api/ping?token=wrong");
    expect(bad.status).toBe(401);
  });
```

> 若计划一 `requireAuth` 签名是 `requireAuth(config)`,用完整 config 或按其测试里既有构造方式。上面用 `as never` 简化。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,query token 未被接受(401)。

- [ ] **Step 3: 修改 `packages/server/src/auth.ts`**

在 `requireAuth` 中间件里,提取 token 时除了 `Authorization: Bearer <t>`,也回退到 `req.query.token`。找到计划一里解析 token 的那行(形如 `const token = req.headers.authorization?.replace(/^Bearer /, "")`),改为:

```ts
    const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const token = headerToken ?? queryToken;
```

其余比对逻辑(`token === config.authToken` 才放行,否则 401)保持计划一原样。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: auth 新增用例 + 计划一原有用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/auth.ts packages/server/src/auth.test.ts
git commit -m "feat(server): accept auth token via query param for SSE"
```

---

### Task 16: 交互卡片组件(答题 / 权限 / 计划)

三个展示组件,接收待答事项与一个回答回调。无状态、纯展示 + 本地选择态,双端共用。

**Files:**
- Create: `packages/web/src/components/QuestionCard.tsx`
- Create: `packages/web/src/components/PermissionCard.tsx`
- Create: `packages/web/src/components/PlanCard.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/PermissionCard.tsx`**

```tsx
import type { PermissionPrompt, PermissionAnswer } from "@cc-web/shared";

export function PermissionCard({
  prompt,
  onAnswer,
}: {
  prompt: PermissionPrompt;
  onAnswer: (a: PermissionAnswer) => void;
}) {
  return (
    <div className="card card-permission">
      <div className="card-title">{prompt.title}</div>
      {prompt.detail && <pre className="card-detail">{prompt.detail}</pre>}
      <div className="card-actions">
        <button
          className="btn btn-allow"
          onClick={() => onAnswer({ kind: "permission", id: prompt.id, decision: "allow" })}
        >
          ✓ 允许
        </button>
        <button
          className="btn btn-deny"
          onClick={() => onAnswer({ kind: "permission", id: prompt.id, decision: "deny" })}
        >
          ✗ 拒绝
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 `packages/web/src/components/PlanCard.tsx`**

```tsx
import type { PlanPrompt, PlanAnswer } from "@cc-web/shared";

export function PlanCard({
  prompt,
  onAnswer,
}: {
  prompt: PlanPrompt;
  onAnswer: (a: PlanAnswer) => void;
}) {
  return (
    <div className="card card-plan">
      <div className="card-title">Claude 提交了一份计划</div>
      <pre className="card-detail card-plan-body">{prompt.plan}</pre>
      <div className="card-actions">
        <button
          className="btn btn-allow"
          onClick={() => onAnswer({ kind: "plan", id: prompt.id, decision: "approve" })}
        >
          批准计划
        </button>
        <button
          className="btn btn-deny"
          onClick={() => onAnswer({ kind: "plan", id: prompt.id, decision: "reject" })}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 写 `packages/web/src/components/QuestionCard.tsx`**

```tsx
import { useState } from "react";
import type { QuestionPrompt, QuestionAnswer } from "@cc-web/shared";

export function QuestionCard({
  prompt,
  onAnswer,
}: {
  prompt: QuestionPrompt;
  onAnswer: (a: QuestionAnswer) => void;
}) {
  // selected[qIndex] = 已选 label 集合
  const [selected, setSelected] = useState<string[][]>(
    prompt.questions.map(() => [])
  );

  function toggle(qi: number, label: string, multi: boolean) {
    setSelected((prev) => {
      const next = prev.map((arr) => [...arr]);
      if (multi) {
        const i = next[qi].indexOf(label);
        if (i >= 0) next[qi].splice(i, 1);
        else next[qi].push(label);
      } else {
        next[qi] = [label];
      }
      return next;
    });
  }

  const allAnswered = selected.every((arr) => arr.length > 0);

  return (
    <div className="card card-question">
      {prompt.questions.map((q, qi) => (
        <div key={qi} className="question-block">
          <div className="card-label">{q.header}</div>
          <div className="card-title">{q.question}</div>
          <div className="options">
            {q.options.map((opt, oi) => {
              const letter = String.fromCharCode(65 + oi);
              const isSel = selected[qi].includes(opt.label);
              return (
                <button
                  key={oi}
                  className={`option ${isSel ? "option-selected" : ""}`}
                  onClick={() => toggle(qi, opt.label, q.multiSelect)}
                >
                  <span className="option-letter">{letter}</span>
                  <span className="option-body">
                    <span className="option-label">{opt.label}</span>
                    <span className="option-desc">{opt.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="card-actions">
        <button
          className="btn btn-allow"
          disabled={!allAnswered}
          onClick={() => onAnswer({ kind: "question", id: prompt.id, answers: selected })}
        >
          提交
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/QuestionCard.tsx packages/web/src/components/PermissionCard.tsx packages/web/src/components/PlanCard.tsx
git commit -m "feat(web): interactive cards (question/permission/plan)"
```

---

### Task 17: Composer(输入框 + 附件/图片上传 + 发送)

底部输入区:文本框、📎/🖼️ 上传、已选附件预览、发送。

**Files:**
- Create: `packages/web/src/components/AttachmentPreview.tsx`
- Create: `packages/web/src/components/Composer.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/AttachmentPreview.tsx`**

```tsx
export interface Attachment {
  ref: string;
  filename: string;
  /** 图片类型时的本地预览 URL */
  previewUrl?: string;
}

export function AttachmentPreview({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (ref: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="attachments">
      {items.map((a) => (
        <div key={a.ref} className="attachment">
          {a.previewUrl ? (
            <img src={a.previewUrl} alt={a.filename} className="attachment-thumb" />
          ) : (
            <span className="attachment-file">📄 {a.filename}</span>
          )}
          <button className="attachment-remove" onClick={() => onRemove(a.ref)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 `packages/web/src/components/Composer.tsx`**

```tsx
import { useRef, useState } from "react";
import { uploadFile } from "../chatApi.js";
import { AttachmentPreview, type Attachment } from "./AttachmentPreview.js";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, attachments: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null, asImage: boolean) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const { ref, filename } = await uploadFile(file);
      setAttachments((prev) => [
        ...prev,
        { ref, filename, previewUrl: asImage ? URL.createObjectURL(file) : undefined },
      ]);
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.map((a) => a.ref));
    setText("");
    setAttachments([]);
  }

  return (
    <div className="composer">
      <AttachmentPreview
        items={attachments}
        onRemove={(ref) => setAttachments((prev) => prev.filter((a) => a.ref !== ref))}
      />
      <div className="composer-row">
        <button
          className="composer-btn"
          title="附件"
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
        <button
          className="composer-btn"
          title="图片"
          onClick={() => imageInput.current?.click()}
        >
          🖼️
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          onChange={(e) => handleFiles(e.target.files, false)}
        />
        <input
          ref={imageInput}
          type="file"
          hidden
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files, true)}
        />
        <textarea
          className="composer-input"
          value={text}
          placeholder="输入消息…"
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="composer-send" disabled={disabled} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/components/AttachmentPreview.tsx packages/web/src/components/Composer.tsx
git commit -m "feat(web): composer with attachment/image upload"
```

---

### Task 18: 对话流接线(渲染流式消息 + 插入交互卡片)

修改计划一的 `Conversation.tsx`:除了渲染历史消息,还渲染 `useSession` 的流式消息与待答卡片。

**Files:**
- Modify: `packages/web/src/components/Conversation.tsx`

- [ ] **Step 1: 修改 `Conversation.tsx` 接受 live 状态与回答回调**

在计划一组件 props 基础上增加可选的 live 渲染。新增 props(保留计划一已有的 `messages` 历史消息渲染):

```tsx
import type { PendingPrompt, PromptAnswer } from "@cc-web/shared";
import type { LiveMessage } from "../useSession.js";
import { Collapsible } from "./Collapsible.js"; // 计划一已有
import { QuestionCard } from "./QuestionCard.js";
import { PermissionCard } from "./PermissionCard.js";
import { PlanCard } from "./PlanCard.js";

// 在计划一 ConversationProps 上扩展:
interface LiveProps {
  liveMessages?: LiveMessage[];
  pending?: PendingPrompt | null;
  onAnswer?: (a: PromptAnswer) => void;
}
```

- [ ] **Step 2: 渲染 live 消息块(在历史消息之后)**

在组件 return 的消息列表渲染之后,追加以下渲染逻辑。`thinking`/`tool_use`/`tool_result` 复用计划一的 `Collapsible`(双端折叠);`text` 直接渲染;`streaming` 作为"正在输入"的尾巴。

```tsx
{liveMessages?.map((m, i) => (
  <div key={`live-${i}`} className="message message-assistant">
    {m.blocks.map((b, bi) => {
      if (b.kind === "text") return <div key={bi} className="msg-text">{b.text}</div>;
      if (b.kind === "thinking")
        return <Collapsible key={bi} summary="💭 思考" body={b.text} />;
      if (b.kind === "tool_use")
        return (
          <Collapsible
            key={bi}
            summary={`${b.name}: ${summarize(b.input)}`}
            body={JSON.stringify(b.input, null, 2)}
          />
        );
      // tool_result
      return (
        <Collapsible
          key={bi}
          summary={b.isError ? "工具结果 ✗" : "工具结果 ✓"}
          body={b.text}
        />
      );
    })}
    {m.streaming && <div className="msg-text msg-streaming">{m.streaming}</div>}
  </div>
))}

{pending && onAnswer && (
  <div className="pending-card">
    {pending.kind === "question" && <QuestionCard prompt={pending} onAnswer={onAnswer} />}
    {pending.kind === "permission" && <PermissionCard prompt={pending} onAnswer={onAnswer} />}
    {pending.kind === "plan" && <PlanCard prompt={pending} onAnswer={onAnswer} />}
  </div>
)}
```

并在文件底部加一个小工具(若计划一已有同名 helper 则复用):

```tsx
function summarize(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.command === "string") return o.command;
    if (typeof o.file_path === "string") return o.file_path;
  }
  try { return JSON.stringify(input).slice(0, 60); } catch { return ""; }
}
```

- [ ] **Step 3: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/components/Conversation.tsx
git commit -m "feat(web): render live stream + interactive cards in conversation"
```

---

### Task 19: App 接线(新建/续聊、useSession、Composer、respond)

把所有部件接到顶层 `App.tsx`:从侧栏选 session → 续聊;点「新建对话」→ 新建;消息发送与答题回调接到 `chatApi`。

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: 在 App 里加入活跃会话状态与接线**

在计划一 `App.tsx`(已有侧栏 + 历史浏览)基础上,增加 runId 状态、`useSession` 订阅、发送/回答/新建逻辑。核心新增片段:

```tsx
import { useState, useCallback } from "react";
import { useSession } from "./useSession.js";
import { startNew, startContinue, sendMessage, respond } from "./chatApi.js";
import { Composer } from "./components/Composer.js";
import type { PromptAnswer } from "@cc-web/shared";

// 在 App 组件内部:
const [runId, setRunId] = useState<string | null>(null);
const { messages: liveMessages, pending, connected, error } = useSession(runId);

const handleContinue = useCallback(async (sessionId: string) => {
  const id = await startContinue(sessionId);
  setRunId(id);
}, []);

const handleNew = useCallback(async () => {
  const id = await startNew();
  setRunId(id);
}, []);

const handleSend = useCallback(
  async (text: string, attachments: string[]) => {
    if (!runId) return;
    await sendMessage(runId, { text, attachments });
  },
  [runId]
);

const handleAnswer = useCallback(
  async (answer: PromptAnswer) => {
    if (!runId) return;
    await respond(runId, answer);
  },
  [runId]
);
```

- [ ] **Step 2: 把这些接到已有 UI**

- 侧栏「新建对话」按钮 onClick → `handleNew`(计划一侧栏已有该按钮,把其回调指向 `handleNew`)。
- 侧栏点击某 session → 计划一是"加载只读历史";现在改为:加载只读历史的同时,提供一个「在此继续」入口调用 `handleContinue(session.id)`(可放在对话视图顶部按钮)。
- `<Conversation>` 传入新增 props:`liveMessages={liveMessages}`、`pending={pending}`、`onAnswer={handleAnswer}`(保留计划一的历史 `messages` props)。
- 在对话视图底部渲染 `<Composer disabled={!runId || !connected} onSend={handleSend} />`。
- 顶栏连接状态显示 `connected`/`error`(计划一已有连接状态位,接上即可)。

> 这一步是"把已有部件用新状态串起来",具体 JSX 取决于计划一 App 的结构。原则:不破坏计划一的只读浏览;续聊是叠加在其上的能力(选了 session 既能看历史,也能点"继续"进入活跃会话)。

- [ ] **Step 3: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): wire up continue/new/send/respond in App"
```

---

### Task 20: 交互卡片样式

为三类卡片、选项按钮、流式尾巴、附件预览补样式,追加到计划一的 `styles.css`,双端一致 + 手机可点。

**Files:**
- Modify: `packages/web/src/styles.css`

- [ ] **Step 1: 追加样式到 `packages/web/src/styles.css`**

```css
/* ── 交互卡片(双端共用) ── */
.card {
  border: 1px solid var(--border, #d0d7de);
  border-radius: 10px;
  padding: 14px;
  margin: 10px 0;
  background: var(--card-bg, #fff);
}
.card-title { font-weight: 600; margin-bottom: 8px; }
.card-label {
  font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
  color: #6e7781; margin-bottom: 4px;
}
.card-detail {
  background: #f6f8fa; border-radius: 6px; padding: 8px 10px;
  white-space: pre-wrap; word-break: break-word; font-size: 13px; margin: 6px 0;
}
.card-plan-body { max-height: 320px; overflow: auto; }
.card-actions { display: flex; gap: 10px; margin-top: 12px; }

.btn {
  flex: 1; padding: 12px 16px; border-radius: 8px; border: none;
  font-size: 15px; cursor: pointer; min-height: 44px; /* 手机可点 */
}
.btn-allow { background: #1f883d; color: #fff; }
.btn-deny { background: #cf222e; color: #fff; }
.btn:disabled { opacity: .5; cursor: not-allowed; }

/* 答题选项 */
.options { display: flex; flex-direction: column; gap: 8px; }
.option {
  display: flex; align-items: flex-start; gap: 10px; text-align: left;
  padding: 12px; border: 1px solid #d0d7de; border-radius: 8px;
  background: #fff; cursor: pointer; min-height: 44px;
}
.option-selected { border-color: #0969da; background: #ddf4ff; }
.option-letter {
  flex: none; width: 26px; height: 26px; border-radius: 50%;
  background: #0969da; color: #fff; display: grid; place-items: center;
  font-size: 13px; font-weight: 600;
}
.option-body { display: flex; flex-direction: column; }
.option-label { font-weight: 600; }
.option-desc { font-size: 13px; color: #57606a; }
.question-block { margin-bottom: 14px; }

/* 流式尾巴 */
.msg-streaming { opacity: .85; }
.msg-streaming::after {
  content: "▋"; animation: blink 1s steps(2, start) infinite; margin-left: 1px;
}
@keyframes blink { to { visibility: hidden; } }

/* 附件预览 */
.attachments { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0; }
.attachment { position: relative; }
.attachment-thumb {
  width: 56px; height: 56px; object-fit: cover; border-radius: 6px;
}
.attachment-file {
  display: inline-block; padding: 6px 10px; background: #f6f8fa;
  border-radius: 6px; font-size: 13px;
}
.attachment-remove {
  position: absolute; top: -6px; right: -6px; width: 20px; height: 20px;
  border-radius: 50%; border: none; background: #cf222e; color: #fff;
  cursor: pointer; line-height: 1;
}

/* Composer */
.composer { border-top: 1px solid #d0d7de; padding: 10px 12px; }
.composer-row { display: flex; align-items: flex-end; gap: 8px; }
.composer-btn {
  flex: none; width: 40px; height: 40px; border: none; background: transparent;
  font-size: 20px; cursor: pointer; border-radius: 8px;
}
.composer-btn:hover { background: #f3f4f6; }
.composer-input {
  flex: 1; resize: none; max-height: 160px; padding: 10px 12px;
  border: 1px solid #d0d7de; border-radius: 8px; font: inherit;
}
.composer-send {
  flex: none; padding: 0 18px; height: 40px; border: none; border-radius: 8px;
  background: #0969da; color: #fff; cursor: pointer;
}
.composer-send:disabled { opacity: .5; cursor: not-allowed; }
```

- [ ] **Step 2: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/styles.css
git commit -m "feat(web): styles for interactive cards / composer / attachments"
```

---

### Task 21: 端到端手动验证(真机续聊 + 答题 + 权限)

同时跑前后端,真机/浏览器验证完整交互链路。需要本机已登录 claude。

- [ ] **Step 1: 起后端**

Run: `AUTH_TOKEN=dev PERMISSION_MODE=default npm run dev:server`(根目录)
Expected: 打印监听 `http://localhost:3000`,无崩溃。

- [ ] **Step 2: 起前端(另一终端)**

Run: `npm run dev:web`
Expected: Vite 打印本地地址(默认 `http://localhost:5173`)。

- [ ] **Step 3: 浏览器/真机验证清单**

打开 Vite 地址(手机用同局域网 IP),逐项确认:
- 登录(token `dev`)→ 进主界面。
- 点「新建对话」→ 顶栏连接状态变"已连接"。
- 输入一句让 claude 必然提问的话(如"帮我在两个方案里选一个,先问我偏好")→ 助手回复**逐字流式**出现。
- claude 抛出 AskUserQuestion → 对话流里出现**答题卡片**,手机上点选 → 提交 → 会话继续。
- 让 claude 执行一个命令(如"运行 ls")→ 出现**权限确认卡片** → 点「允许」→ 命令执行,工具结果默认折叠,可展开。
- 让 claude 进入计划模式并退出 → 出现**计划审批卡片** → 批准/拒绝生效。
- 上传一张图片 + 一个文件 → 预览出现 → 发送不报错。
- 从侧栏选一个**旧 session** → 点「在此继续」→ 能在历史之后继续对话。
- 手机端:抽屉、卡片按钮、输入区在窄屏可用。
- 断网/杀后端再恢复 → 前端 SSE 自动重连,连接状态恢复。

- [ ] **Step 4: 全量测试与构建收尾**

Run: `npm test && npm run build`(根目录)
Expected: 两个计划的全部单测/集成测试 PASS;三包构建成功。

> 此步无新增提交(仅验证)。验证中发现问题,回到对应 Task 修复并提交。

---

## 自检(计划 vs spec)

- **第 3 节(后端↔Claude 集成):** Agent SDK `query()` 适配器 ✓(Task 2)、AsyncIterable 输入队列 ✓(Task 4)、`canUseTool` 挂起—推送—等待—恢复 ✓(Task 3/5)、流式逐字 ✓(Task 5 stream_event → delta)、AskUserQuestion/ExitPlanMode 映射 ✓(Task 5)。
- **第 5 节(API,续聊相关):** `continue` ✓、`new` ✓、`stream`(SSE)✓、`respond` ✓(Task 10);`message` 发消息端点 ✓(Task 10);`uploads` ✓(Task 9)。
- **第 6 节(UI,交互):** 答题卡片 ✓、权限卡片 ✓、计划卡片 ✓(Task 16)、流式渲染 ✓(Task 14/18)、附件/图片上传 ✓(Task 17)、双端折叠复用计划一 Collapsible ✓(Task 18)。
- **第 7 节(配置,SDK 相关):** `PERMISSION_MODE`(计划一定义,Task 2/11 透传)、`SESSION_IDLE_TIMEOUT`(`idleTimeoutMs`)✓、`MAX_CONCURRENT_SESSIONS`(`maxConcurrent`)✓、`UPLOADS_DIR` ✓(Task 8)。
- **第 8 节(错误处理,子进程相关):** 子进程崩溃 → error 事件 ✓(Task 5 catch)、空闲超时回收 ✓(Task 6)、并发上限 ✓(Task 6)、SSE 断线重连 ✓(Task 14)、待答项在会话关闭时被拒绝 ✓(Task 3/5)。
- **第 9 节(安全):** 续聊路由前置鉴权 ✓(Task 11)、SSE 经查询参数 token 鉴权 ✓(Task 15)、`permissionMode` 默认 default ✓(沿用计划一配置);上传大小限制 ✓(Task 9)。

**类型一致性:** `ServerEvent`(delta/block/tool_result/prompt/turn_end/error/closed)、`PendingPrompt`(question/permission/plan)、`PromptAnswer`(对应三类)、`StartSessionResponse`/`SendMessageRequest`/`UploadResponse` 在 Task 1 定义,server(Task 5/9/10)与 web(Task 13/14/16)引用一致;`SdkClient.start(StartQueryParams)` 在 Task 2 定义,Session(Task 5)、SessionManager(Task 6)、fake(Task 5/10 测试)一致;`SessionManager.startNew/startContinue` 的"回调工厂"签名在 Task 10 Step 4 统一,Task 6 测试同步更新;`Session.send/answer/close/runToCompletion` 命名前后统一。

**对计划一的修改点(共 3 处,均向后兼容):** `config.ts` 加 3 字段(Task 8)、`auth.ts` 接受 query token(Task 15)、`routes.ts`/`createApp` 加可选 `sdkClient` 参数并挂载新路由(Task 11)、`Conversation.tsx`/`App.tsx` 叠加 live 渲染(Task 18/19)。这些都不破坏计划一的只读浏览功能。

**无占位符:** 所有代码步骤含完整可运行代码与确切命令;两处刻意标注的"笔误修正"(Task 5 questions 类型、Task 14 delta 死代码)都给了精确的替换写法。
