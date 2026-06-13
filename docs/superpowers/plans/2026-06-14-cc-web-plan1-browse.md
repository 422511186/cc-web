# cc-web 计划一:基础设施 + 历史浏览(只读)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 npm workspaces monorepo,并交付一个只读的历史浏览应用——在网页(含手机)上浏览和搜索本地 Claude Code 的 `.jsonl` 历史聊天,带鉴权。

**Architecture:** 三层 monorepo:`shared`(共享 TS 类型)、`server`(Express 读取并解析 `~/.claude/projects/**/*.jsonl`,提供带鉴权的浏览/搜索 REST API)、`web`(React + Vite 前端,侧栏 + 对话视图 + 双端折叠区块)。本计划不含续聊/SDK 交互,那是计划二。

**Tech Stack:** TypeScript 全栈、Node 24 + Express、React + Vite、Vitest + supertest、npm workspaces。

> 本计划对应 spec:`docs/superpowers/specs/2026-06-14-cc-web-design.md`,覆盖其中第 1/2/4/5/9/10/11/12 节的只读部分,以及第 6 节 UI 的浏览部分。续聊(第 3 节)、配置中与 SDK 相关项(第 7 节)、错误处理中与子进程相关项(第 8 节)留给计划二。

---

## 文件结构

本计划创建的文件及职责:

```
cc-web/
├── package.json                      # 根:workspaces 声明 + 公共脚本
├── tsconfig.base.json                # 共享 TS 编译配置
├── .gitignore                        # (已存在,追加 node_modules / dist)
├── packages/
│   ├── shared/
│   │   ├── package.json              # @cc-web/shared
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # 重导出
│   │       └── api.ts                # Project / SessionMeta / Message / 搜索结果类型
│   ├── server/
│   │   ├── package.json              # @cc-web/server,依赖 @cc-web/shared
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts              # 入口:加载配置 + 启动 Express
│   │       ├── config.ts             # 环境变量配置加载
│   │       ├── jsonl.ts              # JSONL 解析器:行 → Message[]
│   │       ├── title.ts              # 从消息提取 session 标题
│   │       ├── store.ts              # 读目录:列项目 / 列 session / 读单 session
│   │       ├── search.ts             # 内存全文搜索
│   │       ├── auth.ts               # 鉴权中间件 + /api/auth 逻辑
│   │       └── routes.ts             # 组装所有 REST 路由
│   └── web/
│       ├── package.json              # @cc-web/web,依赖 @cc-web/shared
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx              # React 入口
│           ├── App.tsx               # 顶层布局 + 路由状态
│           ├── api.ts                # fetch 封装(带 token)
│           ├── auth.tsx              # 登录界面 + token 存储
│           ├── components/
│           │   ├── Sidebar.tsx       # 可拖拽/可折叠侧栏 + 项目/session 列表 + 搜索
│           │   ├── Conversation.tsx  # 消息流容器
│           │   ├── MessageBubble.tsx # user/assistant 气泡
│           │   └── Collapsible.tsx   # 双端共用:thinking/tool 折叠区块
│           └── styles.css            # 全局样式 + 响应式(桌面/手机)
```

每个文件单一职责。`server/src` 下解析(`jsonl`/`title`)、存储遍历(`store`)、搜索(`search`)、鉴权(`auth`)、路由(`routes`)各自独立,便于单测。

---

## 阶段 A:Monorepo 脚手架

### Task 1: 根 workspace 配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写根 `package.json`**

```json
{
  "name": "cc-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": [
    "packages/shared",
    "packages/server",
    "packages/web"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "dev:server": "npm run dev --workspace @cc-web/server",
    "dev:web": "npm run dev --workspace @cc-web/web"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: 追加 `.gitignore`**

在现有 `.gitignore` 末尾追加(保留已有的 `.superpowers/` 与 `.idea/`):

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 4: 提交**

```bash
git add package.json tsconfig.base.json .gitignore
git commit -m "chore: monorepo root with npm workspaces"
```

---

### Task 2: shared 包骨架 + 构建验证

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: 写 `packages/shared/package.json`**

```json
{
  "name": "@cc-web/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 写 `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/shared/src/index.ts`(临时占位,Task 5 替换内容)**

```ts
export const SHARED_PACKAGE_VERSION = "0.1.0";
```

- [ ] **Step 4: 安装依赖并构建**

Run: `npm install && npm run build --workspace @cc-web/shared`
Expected: 在 `packages/shared/dist/` 生成 `index.js` 和 `index.d.ts`,无错误。

- [ ] **Step 5: 提交**

```bash
git add packages/shared package-lock.json
git commit -m "chore: scaffold @cc-web/shared package"
```

---

### Task 3: server 包骨架 + Vitest

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/src/smoke.test.ts`

- [ ] **Step 1: 写 `packages/server/package.json`**

```json
{
  "name": "@cc-web/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@cc-web/shared": "*",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 写 `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 写临时入口 `packages/server/src/index.ts`**

```ts
export function createApp() {
  // Task 13 会替换为真正的 Express app 组装
  return { ok: true };
}
```

- [ ] **Step 5: 写冒烟测试 `packages/server/src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./index.js";

describe("smoke", () => {
  it("createApp returns ok", () => {
    expect(createApp()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: 安装并跑测试**

Run: `npm install && npm run test --workspace @cc-web/server`
Expected: 1 个测试通过。

- [ ] **Step 7: 提交**

```bash
git add packages/server package.json package-lock.json
git commit -m "chore: scaffold @cc-web/server with vitest"
```

---

### Task 4: web 包骨架 (Vite + React)

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`

- [ ] **Step 1: 写 `packages/web/package.json`**

```json
{
  "name": "@cc-web/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@cc-web/shared": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: 写 `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "jsx": "react-jsx",
    "noEmit": true,
    "types": []
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/web/vite.config.ts`**

代理 `/api` 到后端,避免开发期跨域。

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: 写 `packages/web/index.html`**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cc-web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 写 `packages/web/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: 写临时 `packages/web/src/App.tsx`(后续任务替换)**

```tsx
export function App() {
  return <div>cc-web</div>;
}
```

- [ ] **Step 7: 安装并验证构建**

Run: `npm install && npm run build --workspace @cc-web/web`
Expected: 在 `packages/web/dist/` 生成产物,无 TS 错误。

- [ ] **Step 8: 提交**

```bash
git add packages/web package.json package-lock.json
git commit -m "chore: scaffold @cc-web/web with vite + react"
```

---

> 阶段 A 完成后,monorepo 三包就位、可构建、可测试。

---

## 阶段 B:共享类型

> **数据格式说明(来自真实 `.jsonl` 抽样):** 每行是一个 JSON 对象,有顶层 `type` 字段。可展示的核心类型是 `user` 和 `assistant`,它们都带 `message` 字段,`message.content` **可能是字符串,也可能是内容块数组**。内容块的 `type` 有 `text`(含 `text`)、`thinking`(含 `thinking`)、`tool_use`(含 `name`/`input`)、`tool_result`(含 `tool_use_id`/`content`/可选 `is_error`)。另有一种 `ai-title` 行,直接存了 session 标题(字段 `aiTitle`)。其余类型(`system`/`mode`/`permission-mode`/`file-history-snapshot`/`last-prompt`/`text`(顶层)/`thinking`(顶层)等)在浏览视图里跳过。

### Task 5: 共享类型定义

**Files:**
- Create: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写 `packages/shared/src/api.ts`**

定义贯穿前后端的浏览数据契约。这些类型同时被 `server`(组装响应)和 `web`(渲染)使用。

```ts
// 一个项目(对应 ~/.claude/projects 下的一个目录)
export interface Project {
  /** 目录名,编码过的路径,如 "C--Users-huang-Desktop";用作 API 路径里的 :id */
  id: string;
  /** 尝试解码回的可读路径,如 "C:\\Users\\huang\\Desktop";解不出时等于 id */
  displayPath: string;
  /** 该项目下的 session 数量 */
  sessionCount: number;
}

// 一个 session 的元信息(列表用,不含完整消息)
export interface SessionMeta {
  /** session id,等于 jsonl 文件名去掉扩展名 */
  id: string;
  /** 所属项目 id */
  projectId: string;
  /** 标题:优先 ai-title,回退首条 user 消息截断 */
  title: string;
  /** 该 session 第一条消息的时间戳(ISO 字符串),无则空串 */
  startedAt: string;
  /** 可展示消息条数 */
  messageCount: number;
}

// 单个内容块(assistant/user 消息体里的元素)
export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; name: string; input: unknown; toolUseId: string }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean };

// 一条规范化后的可展示消息
export interface Message {
  /** 原始记录的 uuid,前端做 key;缺失时由 server 生成回退值 */
  uuid: string;
  role: "user" | "assistant";
  /** 规范化后的内容块序列 */
  blocks: ContentBlock[];
  /** ISO 时间戳,缺失为空串 */
  timestamp: string;
  /** assistant 消息的模型名;user 或缺失为 null */
  model: string | null;
}

// GET /api/sessions/:id 的响应
export interface SessionDetail {
  meta: SessionMeta;
  messages: Message[];
}

// GET /api/search?q= 的单条命中
export interface SearchHit {
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  /** 命中消息的角色 */
  role: "user" | "assistant";
  /** 命中文本的一段摘录(含关键字上下文) */
  snippet: string;
  timestamp: string;
}

// POST /api/auth 的请求与响应
export interface AuthRequest {
  token: string;
}
export interface AuthResponse {
  ok: boolean;
}
```

- [ ] **Step 2: 用 `packages/shared/src/index.ts` 重导出**

```ts
export * from "./api.js";
```

- [ ] **Step 3: 构建 shared 验证类型无误**

Run: `npm run build --workspace @cc-web/shared`
Expected: `packages/shared/dist/` 重新生成 `api.js`/`api.d.ts`/`index.js`/`index.d.ts`,无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src
git commit -m "feat(shared): browse data contract types"
```

---

## 阶段 C:数据层(解析 + 遍历 + 搜索)

### Task 6: JSONL 行解析为规范化消息

把单行 JSON 解析成 `Message | null`(null 表示该行不可展示,需跳过)。这是整个数据层的核心纯函数,重点测各种 content 形态与容错。

**Files:**
- Create: `packages/server/src/jsonl.ts`
- Test: `packages/server/src/jsonl.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/jsonl.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseLine } from "./jsonl.js";

describe("parseLine", () => {
  it("parses a user message with string content", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "2026-06-13T18:55:35.229Z",
      message: { role: "user", content: "认可的认可的" },
    });
    const msg = parseLine(line);
    expect(msg).toEqual({
      uuid: "u1",
      role: "user",
      blocks: [{ kind: "text", text: "认可的认可的" }],
      timestamp: "2026-06-13T18:55:35.229Z",
      model: null,
    });
  });

  it("parses an assistant message with thinking + text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-06-13T18:56:00.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          { type: "thinking", thinking: "thinking out loud" },
          { type: "text", text: "hello" },
        ],
      },
    });
    const msg = parseLine(line);
    expect(msg).toEqual({
      uuid: "a1",
      role: "assistant",
      blocks: [
        { kind: "thinking", text: "thinking out loud" },
        { kind: "text", text: "hello" },
      ],
      timestamp: "2026-06-13T18:56:00.000Z",
      model: "claude-opus-4-8",
    });
  });

  it("parses tool_use and tool_result blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "a2",
      timestamp: "",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          { type: "tool_use", name: "Bash", id: "tu1", input: { command: "ls" } },
        ],
      },
    });
    const msg = parseLine(line);
    expect(msg!.blocks).toEqual([
      { kind: "tool_use", name: "Bash", input: { command: "ls" }, toolUseId: "tu1" },
    ]);
  });

  it("parses a user tool_result (string content)", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u2",
      timestamp: "",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu1", content: "output text" },
        ],
      },
    });
    const msg = parseLine(line);
    expect(msg!.blocks).toEqual([
      { kind: "tool_result", toolUseId: "tu1", text: "output text", isError: false },
    ]);
  });

  it("returns null for noise types", () => {
    for (const type of ["system", "mode", "file-history-snapshot", "last-prompt", "ai-title"]) {
      expect(parseLine(JSON.stringify({ type }))).toBeNull();
    }
  });

  it("returns null for a corrupt / non-JSON line", () => {
    expect(parseLine("{not json")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  it("generates a fallback uuid when missing", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hi" },
    });
    const msg = parseLine(line);
    expect(msg!.uuid).toMatch(/^gen-/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,报 `parseLine` 未定义 / 模块找不到。

- [ ] **Step 3: 实现 `packages/server/src/jsonl.ts`**

```ts
import type { ContentBlock, Message } from "@cc-web/shared";

/** 浏览视图跳过的顶层 type */
const NOISE_TYPES = new Set([
  "system",
  "mode",
  "permission-mode",
  "file-history-snapshot",
  "last-prompt",
  "ai-title",
  "text",
  "thinking",
  "attachment",
  "command_permissions",
  "create",
  "deferred_tools_delta",
  "hook_additional_context",
  "hook_success",
  "opened_file_in_ide",
  "queue-operation",
  "queued_command",
  "skill_listing",
  "task_reminder",
  "tool_reference",
  "tool_use",
  "tool_result",
  "message",
  "ai-title",
]);

let genCounter = 0;

/** 把原始 content(字符串或块数组)规范化为 ContentBlock[] */
function normalizeContent(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return content.length ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      case "text":
        blocks.push({ kind: "text", text: String(b.text ?? "") });
        break;
      case "thinking":
        blocks.push({ kind: "thinking", text: String(b.thinking ?? "") });
        break;
      case "tool_use":
        blocks.push({
          kind: "tool_use",
          name: String(b.name ?? "tool"),
          input: b.input ?? {},
          toolUseId: String(b.id ?? ""),
        });
        break;
      case "tool_result": {
        const c = b.content;
        const text = typeof c === "string" ? c : JSON.stringify(c ?? "");
        blocks.push({
          kind: "tool_result",
          toolUseId: String(b.tool_use_id ?? ""),
          text,
          isError: Boolean(b.is_error),
        });
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

/**
 * 解析一行 JSONL。返回可展示的 Message,或 null(噪音行 / 损坏行 / 无内容)。
 */
export function parseLine(line: string): Message | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const type = obj.type;
  if (type !== "user" && type !== "assistant") return null;

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return null;
  const role = message.role === "assistant" ? "assistant" : "user";
  const blocks = normalizeContent(message.content);
  if (blocks.length === 0) return null;

  return {
    uuid: typeof obj.uuid === "string" && obj.uuid ? obj.uuid : `gen-${++genCounter}`,
    role,
    blocks,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    model: role === "assistant" && typeof message.model === "string" ? message.model : null,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: 上述 7 个 `parseLine` 测试全部 PASS(连同 Task 3 的冒烟测试)。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/jsonl.ts packages/server/src/jsonl.test.ts
git commit -m "feat(server): jsonl line parser with content normalization"
```

---

### Task 7: session 标题提取

从一个 session 的原始行中提取标题:优先用 `ai-title` 行的 `aiTitle`,否则取第一条 user 文本消息截断到 60 字符,都没有则回退 "(无标题)"。

**Files:**
- Create: `packages/server/src/title.ts`
- Test: `packages/server/src/title.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/title.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { extractTitle } from "./title.js";

describe("extractTitle", () => {
  it("prefers ai-title line", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "first prompt" } }),
      JSON.stringify({ type: "ai-title", aiTitle: "A Nice Title" }),
    ];
    expect(extractTitle(lines)).toBe("A Nice Title");
  });

  it("falls back to first user message, truncated to 60 chars", () => {
    const long = "x".repeat(100);
    const lines = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hi" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: long } }),
    ];
    const title = extractTitle(lines);
    expect(title.length).toBe(60);
    expect(title).toBe("x".repeat(60));
  });

  it("uses full short user message", () => {
    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "你好世界" } }),
    ];
    expect(extractTitle(lines)).toBe("你好世界");
  });

  it("returns placeholder when nothing usable", () => {
    const lines = [JSON.stringify({ type: "system" }), "{corrupt"];
    expect(extractTitle(lines)).toBe("(无标题)");
  });

  it("extracts text from first user message with array content", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "数组里的文字" }] },
      }),
    ];
    expect(extractTitle(lines)).toBe("数组里的文字");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`extractTitle` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/title.ts`**

```ts
const MAX_TITLE = 60;

/** 从原始 content 取纯文本(用于标题);取第一段 text。 */
function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const raw of content) {
      if (raw && typeof raw === "object" && (raw as any).type === "text") {
        return String((raw as any).text ?? "");
      }
    }
  }
  return "";
}

/**
 * 提取 session 标题。
 * 优先级:ai-title 行 > 第一条 user 文本消息(截断 60)> "(无标题)"。
 */
export function extractTitle(lines: string[]): string {
  let firstUserText = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj.type === "ai-title" && typeof obj.aiTitle === "string" && obj.aiTitle.trim()) {
      return obj.aiTitle.trim();
    }
    if (!firstUserText && obj.type === "user") {
      const message = obj.message as Record<string, unknown> | undefined;
      const text = firstText(message?.content).trim();
      if (text) firstUserText = text;
    }
  }
  if (firstUserText) return firstUserText.slice(0, MAX_TITLE);
  return "(无标题)";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: 5 个 `extractTitle` 测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/title.ts packages/server/src/title.test.ts
git commit -m "feat(server): session title extraction"
```

---

> 阶段 C 余下的 store(目录遍历)与 search(全文搜索)见下。

---

### Task 8: store —— 目录遍历(列项目 / 列 session / 读单 session)

`store` 负责所有文件系统访问:把 `CLAUDE_PROJECTS_DIR` 下的目录/文件读成 `Project`、`SessionMeta`、`SessionDetail`。为了可测试,所有函数接收 `rootDir` 参数而非读全局配置,测试时指向临时目录。

**Files:**
- Create: `packages/server/src/store.ts`
- Test: `packages/server/src/store.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/store.test.ts`**

测试用 `node:fs` 在临时目录里造数据,跑完清理。

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listProjects, listSessions, readSession } from "./store.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-web-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSession(projectId: string, sessionId: string, lines: object[]) {
  const dir = join(root, projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
    "utf8"
  );
}

describe("listProjects", () => {
  it("lists project directories with session counts", () => {
    writeSession("C--Users-huang-Desktop", "s1", [
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    writeSession("C--Users-huang-Desktop", "s2", [
      { type: "user", message: { role: "user", content: "yo" } },
    ]);
    writeSession("C--proj-b", "s3", [
      { type: "user", message: { role: "user", content: "hey" } },
    ]);

    const projects = listProjects(root);
    const desktop = projects.find((p) => p.id === "C--Users-huang-Desktop");
    expect(desktop).toBeDefined();
    expect(desktop!.sessionCount).toBe(2);
    expect(desktop!.displayPath).toBe("C:\\Users\\huang\\Desktop");
  });

  it("returns empty array when root does not exist", () => {
    expect(listProjects(join(root, "nope"))).toEqual([]);
  });
});

describe("listSessions", () => {
  it("returns session metas with title and message count", () => {
    writeSession("proj", "sess-1", [
      { type: "user", uuid: "u1", timestamp: "2026-06-13T00:00:00.000Z", message: { role: "user", content: "first prompt here" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", model: "claude-opus-4-8", content: "reply" } },
      { type: "system" },
    ]);
    const sessions = listSessions(root, "proj");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "sess-1",
      projectId: "proj",
      title: "first prompt here",
      startedAt: "2026-06-13T00:00:00.000Z",
      messageCount: 2,
    });
  });

  it("returns empty array for unknown project", () => {
    expect(listSessions(root, "ghost")).toEqual([]);
  });
});

describe("readSession", () => {
  it("returns meta + full message list", () => {
    writeSession("proj", "sess-1", [
      { type: "user", uuid: "u1", message: { role: "user", content: "q" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", model: "m", content: "a" } },
    ]);
    const detail = readSession(root, "proj", "sess-1");
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.meta.id).toBe("sess-1");
  });

  it("returns null for missing session", () => {
    expect(readSession(root, "proj", "ghost")).toBeNull();
  });

  it("rejects ids containing path separators (traversal guard)", () => {
    expect(readSession(root, "..", "x")).toBeNull();
    expect(readSession(root, "proj", "../../etc/passwd")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`store` 模块/函数未定义。

- [ ] **Step 3: 实现 `packages/server/src/store.ts`**

```ts
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Project, SessionMeta, SessionDetail, Message } from "@cc-web/shared";
import { parseLine } from "./jsonl.js";
import { extractTitle } from "./title.js";

/** 把编码过的目录名解码回可读路径:"C--Users-huang-Desktop" -> "C:\Users\huang\Desktop" */
function decodeProjectId(id: string): string {
  // 首段单字母后跟 "--" 视为盘符;其余 "-" 视为路径分隔。
  const m = id.match(/^([A-Za-z])--(.*)$/);
  if (m) {
    return `${m[1]}:\\${m[2].replace(/-/g, "\\")}`;
  }
  return id;
}

/** 校验 id 不含路径分隔符或上跳,防目录穿越。 */
function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes("/") && !id.includes("\\") && id !== "." && id !== "..";
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}

function sessionFiles(rootDir: string, projectId: string): string[] {
  const dir = join(rootDir, projectId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
}

export function listProjects(rootDir: string): Project[] {
  if (!existsSync(rootDir)) return [];
  const projects: Project[] = [];
  for (const entry of readdirSync(rootDir)) {
    const full = join(rootDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const count = sessionFiles(rootDir, entry).length;
    projects.push({ id: entry, displayPath: decodeProjectId(entry), sessionCount: count });
  }
  return projects;
}

export function listSessions(rootDir: string, projectId: string): SessionMeta[] {
  if (!isSafeId(projectId)) return [];
  const metas: SessionMeta[] = [];
  for (const file of sessionFiles(rootDir, projectId)) {
    const id = file.replace(/\.jsonl$/, "");
    const lines = readLines(join(rootDir, projectId, file));
    const messages = lines.map(parseLine).filter((m): m is Message => m !== null);
    metas.push({
      id,
      projectId,
      title: extractTitle(lines),
      startedAt: messages[0]?.timestamp ?? "",
      messageCount: messages.length,
    });
  }
  return metas;
}

export function readSession(
  rootDir: string,
  projectId: string,
  sessionId: string
): SessionDetail | null {
  if (!isSafeId(projectId) || !isSafeId(sessionId)) return null;
  const file = join(rootDir, projectId, `${sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  const lines = readLines(file);
  const messages = lines.map(parseLine).filter((m): m is Message => m !== null);
  return {
    meta: {
      id: sessionId,
      projectId,
      title: extractTitle(lines),
      startedAt: messages[0]?.timestamp ?? "",
      messageCount: messages.length,
    },
    messages,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: store 的 7 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/store.ts packages/server/src/store.test.ts
git commit -m "feat(server): store for projects/sessions traversal with traversal guard"
```

---

### Task 9: search —— 内存全文搜索

遍历所有项目的所有 session,在每条消息的文本块里做大小写不敏感的关键字匹配,命中则返回带摘录的 `SearchHit`。

**Files:**
- Create: `packages/server/src/search.ts`
- Test: `packages/server/src/search.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/search.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { search } from "./search.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-web-search-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSession(projectId: string, sessionId: string, lines: object[]) {
  const dir = join(root, projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
    "utf8"
  );
}

describe("search", () => {
  it("finds matching messages across projects, case-insensitive", () => {
    writeSession("p1", "s1", [
      { type: "user", uuid: "u1", timestamp: "t1", message: { role: "user", content: "Hello WORLD" } },
    ]);
    writeSession("p2", "s2", [
      { type: "assistant", uuid: "a1", timestamp: "t2", message: { role: "assistant", model: "m", content: "no match here" } },
    ]);

    const hits = search(root, "world");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      projectId: "p1",
      sessionId: "s1",
      role: "user",
    });
    expect(hits[0].snippet.toLowerCase()).toContain("world");
  });

  it("returns empty for blank query", () => {
    writeSession("p1", "s1", [
      { type: "user", uuid: "u1", message: { role: "user", content: "anything" } },
    ]);
    expect(search(root, "  ")).toEqual([]);
  });

  it("returns empty when nothing matches", () => {
    writeSession("p1", "s1", [
      { type: "user", uuid: "u1", message: { role: "user", content: "abc" } },
    ]);
    expect(search(root, "zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`search` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/search.ts`**

```ts
import type { SearchHit, ContentBlock } from "@cc-web/shared";
import { listProjects, listSessions, readSession } from "./store.js";

const SNIPPET_PAD = 40;

/** 取一个块的可搜索文本 */
function blockText(block: ContentBlock): string {
  switch (block.kind) {
    case "text":
    case "thinking":
    case "tool_result":
      return block.text;
    case "tool_use":
      return `${block.name} ${JSON.stringify(block.input)}`;
  }
}

/** 围绕命中位置截一段摘录 */
function makeSnippet(text: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - SNIPPET_PAD);
  const end = Math.min(text.length, idx + qLen + SNIPPET_PAD);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

/**
 * 在 rootDir 下所有 session 中全文搜索 query(大小写不敏感)。
 * MVP:无索引,逐 session 扫描。
 */
export function search(rootDir: string, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const project of listProjects(rootDir)) {
    for (const meta of listSessions(rootDir, project.id)) {
      const detail = readSession(rootDir, project.id, meta.id);
      if (!detail) continue;
      for (const msg of detail.messages) {
        for (const block of msg.blocks) {
          const text = blockText(block);
          const idx = text.toLowerCase().indexOf(q);
          if (idx >= 0) {
            hits.push({
              projectId: project.id,
              sessionId: meta.id,
              sessionTitle: meta.title,
              role: msg.role,
              snippet: makeSnippet(text, idx, q.length),
              timestamp: msg.timestamp,
            });
            break; // 每条消息只记一次命中
          }
        }
      }
    }
  }
  return hits;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: search 的 3 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/search.ts packages/server/src/search.test.ts
git commit -m "feat(server): in-memory full-text search"
```

---

## 阶段 D:配置 + 鉴权 + REST API

### Task 10: 配置加载

从环境变量读取本计划需要的配置项(鉴权 token、端口、历史根目录)。SDK/续聊相关项(`PERMISSION_MODE` 等)留给计划二。

**Files:**
- Create: `packages/server/src/config.ts`
- Test: `packages/server/src/config.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads values from the provided env object", () => {
    const cfg = loadConfig({
      AUTH_TOKEN: "secret",
      PORT: "4000",
      CLAUDE_PROJECTS_DIR: "/tmp/projects",
    });
    expect(cfg).toEqual({
      authToken: "secret",
      port: 4000,
      projectsDir: "/tmp/projects",
    });
  });

  it("defaults port to 3000 when unset", () => {
    const cfg = loadConfig({ AUTH_TOKEN: "x", CLAUDE_PROJECTS_DIR: "/d" });
    expect(cfg.port).toBe(3000);
  });

  it("defaults projectsDir to ~/.claude/projects when unset", () => {
    const cfg = loadConfig({ AUTH_TOKEN: "x" });
    expect(cfg.projectsDir).toContain(".claude");
    expect(cfg.projectsDir).toContain("projects");
  });

  it("throws when AUTH_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow(/AUTH_TOKEN/);
  });
}); 
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`loadConfig` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/config.ts`**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  authToken: string;
  port: number;
  projectsDir: string;
}

/** 从 env 对象(默认 process.env)加载配置。传参以便测试。 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const authToken = env.AUTH_TOKEN;
  if (!authToken) {
    throw new Error("AUTH_TOKEN is required but was not set");
  }
  return {
    authToken,
    port: env.PORT ? Number(env.PORT) : 3000,
    projectsDir: env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects"),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: config 的 4 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/config.ts packages/server/src/config.test.ts
git commit -m "feat(server): config loader from env"
```

---

### Task 11: 鉴权中间件 + /api/auth

单一 token 鉴权。客户端先 `POST /api/auth` 提交 token 验证,之后每个请求带 `Authorization: Bearer <token>` 头。中间件用**恒定时间比较**避免计时攻击,并放行 `/api/auth` 本身。

**Files:**
- Create: `packages/server/src/auth.ts`
- Test: `packages/server/src/auth.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/auth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requireAuth, authRoute } from "./auth.js";

function makeApp(token: string) {
  const app = express();
  app.use(express.json());
  app.post("/api/auth", authRoute(token));
  app.use("/api", requireAuth(token));
  app.get("/api/secret", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("authRoute", () => {
  it("returns ok:true for correct token", async () => {
    const res = await request(makeApp("s3cr3t")).post("/api/auth").send({ token: "s3cr3t" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 401 for wrong token", async () => {
    const res = await request(makeApp("s3cr3t")).post("/api/auth").send({ token: "nope" });
    expect(res.status).toBe(401);
  });
});

describe("requireAuth", () => {
  it("rejects requests without bearer token", async () => {
    const res = await request(makeApp("s3cr3t")).get("/api/secret");
    expect(res.status).toBe(401);
  });

  it("allows requests with correct bearer token", async () => {
    const res = await request(makeApp("s3cr3t"))
      .get("/api/secret")
      .set("Authorization", "Bearer s3cr3t");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects requests with wrong bearer token", async () => {
    const res = await request(makeApp("s3cr3t"))
      .get("/api/secret")
      .set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`auth` 模块未定义。

- [ ] **Step 3: 实现 `packages/server/src/auth.ts`**

```ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

/** 恒定时间字符串比较,避免计时攻击;长度不等直接 false。 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** POST /api/auth:校验 body.token。 */
export function authRoute(expected: string): RequestHandler {
  return (req: Request, res: Response) => {
    const token = (req.body?.token ?? "") as string;
    if (typeof token === "string" && safeEqual(token, expected)) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false });
    }
  };
}

/** 鉴权中间件:要求 Authorization: Bearer <token>。 */
export function requireAuth(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const match = header.match(/^Bearer (.+)$/);
    if (match && safeEqual(match[1], expected)) {
      next();
    } else {
      res.status(401).json({ error: "unauthorized" });
    }
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: auth 的 5 个测试 PASS。

> 注:`authRoute` 与 `requireAuth` 都接收 `expected` token 作参数(而非内部读 config),与 `store`/`search` 一样保持纯函数风格,便于测试。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/auth.ts packages/server/src/auth.test.ts
git commit -m "feat(server): single-token auth middleware and /api/auth"
```

---

### Task 12: REST 路由组装

把 store/search/auth 串成 Express app。所有 `/api/*`(除 `/api/auth`)走鉴权。路由函数接收 `config`,把 `projectsDir` 传给 store/search。

**Files:**
- Create: `packages/server/src/routes.ts`
- Test: `packages/server/src/routes.test.ts`

- [ ] **Step 1: 写失败测试 `packages/server/src/routes.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { createApp } from "./routes.js";

let root: string;
const TOKEN = "t0ken";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-web-routes-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSession(projectId: string, sessionId: string, lines: object[]) {
  const dir = join(root, projectId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n"),
    "utf8"
  );
}

function app() {
  return createApp({ authToken: TOKEN, port: 0, projectsDir: root });
}
const bearer = { Authorization: `Bearer ${TOKEN}` };

describe("REST routes", () => {
  it("GET /api/projects requires auth", async () => {
    const res = await request(app()).get("/api/projects");
    expect(res.status).toBe(401);
  });

  it("GET /api/projects lists projects", async () => {
    writeSession("p1", "s1", [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]);
    const res = await request(app()).get("/api/projects").set(bearer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("p1");
  });

  it("GET /api/projects/:id/sessions lists sessions", async () => {
    writeSession("p1", "s1", [{ type: "user", uuid: "u1", message: { role: "user", content: "hello there" } }]);
    const res = await request(app()).get("/api/projects/p1/sessions").set(bearer);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "s1", projectId: "p1" });
  });

  it("GET /api/sessions/:id returns detail or 404", async () => {
    writeSession("p1", "s1", [
      { type: "user", uuid: "u1", message: { role: "user", content: "q" } },
      { type: "assistant", uuid: "a1", message: { role: "assistant", model: "m", content: "a" } },
    ]);
    const ok = await request(app()).get("/api/sessions/s1?project=p1").set(bearer);
    expect(ok.status).toBe(200);
    expect(ok.body.messages).toHaveLength(2);

    const missing = await request(app()).get("/api/sessions/ghost?project=p1").set(bearer);
    expect(missing.status).toBe(404);
  });

  it("GET /api/search?q= returns hits", async () => {
    writeSession("p1", "s1", [{ type: "user", uuid: "u1", message: { role: "user", content: "find me please" } }]);
    const res = await request(app()).get("/api/search?q=find").set(bearer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].sessionId).toBe("s1");
  });

  it("POST /api/auth validates token", async () => {
    const ok = await request(app()).post("/api/auth").send({ token: TOKEN });
    expect(ok.status).toBe(200);
    const bad = await request(app()).post("/api/auth").send({ token: "x" });
    expect(bad.status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test --workspace @cc-web/server`
Expected: FAIL,`createApp` 签名不符 / `routes` 未定义。

- [ ] **Step 3: 实现 `packages/server/src/routes.ts`**

`GET /api/sessions/:id` 用查询参数 `?project=<projectId>` 定位项目(session id 在不同项目间可能重复,需项目限定)。

```ts
import express, { type Express, type Request, type Response } from "express";
import type { Config } from "./config.js";
import { requireAuth, authRoute } from "./auth.js";
import { listProjects, listSessions, readSession } from "./store.js";
import { search } from "./search.js";

export function createApp(config: Config): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // 鉴权端点(不需要预先鉴权)
  app.post("/api/auth", authRoute(config.authToken));

  // 其余 /api/* 全部需要鉴权
  app.use("/api", requireAuth(config.authToken));

  app.get("/api/projects", (_req: Request, res: Response) => {
    res.json(listProjects(config.projectsDir));
  });

  app.get("/api/projects/:id/sessions", (req: Request, res: Response) => {
    res.json(listSessions(config.projectsDir, req.params.id));
  });

  app.get("/api/search", (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(search(config.projectsDir, q));
  });

  app.get("/api/sessions/:id", (req: Request, res: Response) => {
    const projectId = typeof req.query.project === "string" ? req.query.project : "";
    const detail = readSession(config.projectsDir, projectId, req.params.id);
    if (!detail) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.json(detail);
  });

  return app;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test --workspace @cc-web/server`
Expected: routes 的 6 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes.ts packages/server/src/routes.test.ts
git commit -m "feat(server): assemble REST routes for browse + search"
```

---

### Task 13: server 入口(替换占位 index.ts)

把 Task 3 的占位 `createApp` 换成真正的启动逻辑:加载配置、用 `routes.ts` 的 `createApp` 建 app、监听端口。

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/smoke.test.ts`(删除——已被 routes.test.ts 取代)

- [ ] **Step 1: 删除过时的冒烟测试**

```bash
git rm packages/server/src/smoke.test.ts
```

- [ ] **Step 2: 重写 `packages/server/src/index.ts`**

```ts
import { loadConfig } from "./config.js";
import { createApp } from "./routes.js";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  // eslint 友好:用 console 输出启动信息
  console.log(`cc-web server listening on http://localhost:${config.port}`);
  console.log(`serving history from ${config.projectsDir}`);
});
```

- [ ] **Step 3: 构建并跑全部 server 测试**

Run: `npm run build --workspace @cc-web/server && npm run test --workspace @cc-web/server`
Expected: 构建无错误;config/auth/store/search/routes/jsonl/title 全部测试 PASS。

- [ ] **Step 4: 手动验证启动(可选)**

Run: `AUTH_TOKEN=dev npm run dev --workspace @cc-web/server`
Expected: 打印监听地址;浏览器访问 `http://localhost:3000/api/projects` 应返回 401(无 token),带 `Authorization: Bearer dev` 则返回项目列表。验证后 Ctrl-C 停止。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): real entrypoint loading config and serving routes"
```

---

## 阶段 E:前端(浏览 UI)

> 前端用共享类型(`Project`/`SessionMeta`/`SessionDetail`/`Message`/`ContentBlock`/`SearchHit`/`AuthResponse`)。token 存 `localStorage`,每个请求带 `Authorization: Bearer`。本阶段只读浏览,无续聊。

### Task 14: API 封装 + token 存储

**Files:**
- Create: `packages/web/src/api.ts`

- [ ] **Step 1: 写 `packages/web/src/api.ts`**

```ts
import type {
  Project,
  SessionMeta,
  SessionDetail,
  SearchHit,
} from "@cc-web/shared";

const TOKEN_KEY = "cc-web-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 抛出此错误表示 token 失效,UI 应退回登录页。 */
export class UnauthorizedError extends Error {}

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) throw new UnauthorizedError("unauthorized");
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** 校验 token:成功则存储并返回 true。 */
export async function login(token: string): Promise<boolean> {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) {
    setToken(token);
    return true;
  }
  return false;
}

export const fetchProjects = () => apiGet<Project[]>("/api/projects");
export const fetchSessions = (projectId: string) =>
  apiGet<SessionMeta[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`);
export const fetchSession = (projectId: string, sessionId: string) =>
  apiGet<SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(projectId)}`
  );
export const searchHistory = (q: string) =>
  apiGet<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`);
```

- [ ] **Step 2: 构建验证(类型)**

Run: `npm run build --workspace @cc-web/web`
Expected: 暂时可能因 App.tsx 未用到这些导出而无错误;主要确认 import 路径与类型解析正确,无 TS 报错。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/api.ts
git commit -m "feat(web): api client with token storage"
```

---

### Task 15: 登录界面

token 缺失或失效时显示。输入 token → 调 `login()` → 成功进入主界面。

**Files:**
- Create: `packages/web/src/auth.tsx`

- [ ] **Step 1: 写 `packages/web/src/auth.tsx`**

```tsx
import { useState } from "react";
import { login } from "./api.js";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    const ok = await login(token);
    setBusy(false);
    if (ok) onSuccess();
    else setError(true);
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>cc-web</h1>
        <p className="login-sub">输入访问令牌</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="令牌"
          autoFocus
        />
        {error && <p className="login-error">令牌错误</p>}
        <button type="submit" disabled={busy || !token}>
          {busy ? "验证中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/auth.tsx
git commit -m "feat(web): login screen"
```

---

### Task 16: 折叠区块组件(双端共用)

`thinking` 与 `tool_use`/`tool_result` 默认折叠,点摘要条展开。桌面/手机共用同一组件。

**Files:**
- Create: `packages/web/src/components/Collapsible.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/Collapsible.tsx`**

```tsx
import { useState, type ReactNode } from "react";

export function Collapsible({
  icon,
  summary,
  status,
  children,
}: {
  icon: string;
  summary: string;
  status?: "running" | "ok" | "error";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const statusMark =
    status === "ok" ? "✓" : status === "error" ? "✗" : status === "running" ? "…" : "";
  return (
    <div className={`collapsible ${status ?? ""}`}>
      <button className="collapsible-head" onClick={() => setOpen((v) => !v)}>
        <span className="collapsible-arrow">{open ? "▾" : "▸"}</span>
        <span className="collapsible-icon">{icon}</span>
        <span className="collapsible-summary">{summary}</span>
        {statusMark && <span className="collapsible-status">{statusMark}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/components/Collapsible.tsx
git commit -m "feat(web): collapsible block component for thinking/tool"
```

---

### Task 17: 消息气泡组件

把一条 `Message` 的 `blocks` 渲染出来:`text` 直接显示;`thinking`/`tool_use`/`tool_result` 用 `Collapsible` 折叠。

**Files:**
- Create: `packages/web/src/components/MessageBubble.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/MessageBubble.tsx`**

```tsx
import type { Message, ContentBlock } from "@cc-web/shared";
import { Collapsible } from "./Collapsible.js";

function Block({ block }: { block: ContentBlock }) {
  switch (block.kind) {
    case "text":
      return <div className="block-text">{block.text}</div>;
    case "thinking":
      return (
        <Collapsible icon="💭" summary={block.text.split("\n")[0] || "思考中…"}>
          <pre className="block-pre">{block.text}</pre>
        </Collapsible>
      );
    case "tool_use":
      return (
        <Collapsible icon="🛠" summary={block.name}>
          <pre className="block-pre">{JSON.stringify(block.input, null, 2)}</pre>
        </Collapsible>
      );
    case "tool_result":
      return (
        <Collapsible
          icon="📤"
          summary={`结果${block.isError ? "(错误)" : ""}`}
          status={block.isError ? "error" : "ok"}
        >
          <pre className="block-pre">{block.text}</pre>
        </Collapsible>
      );
  }
}

export function MessageBubble({ message }: { message: Message }) {
  return (
    <div className={`bubble bubble-${message.role}`}>
      {message.model && <div className="bubble-model">{message.model}</div>}
      {message.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/components/MessageBubble.tsx
git commit -m "feat(web): message bubble rendering blocks with collapsibles"
```

---

### Task 18: 对话视图组件

接收 `projectId`+`sessionId`,拉取 `SessionDetail`,渲染消息流。加载/错误/空态各有提示。

**Files:**
- Create: `packages/web/src/components/Conversation.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/Conversation.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { SessionDetail } from "@cc-web/shared";
import { fetchSession, UnauthorizedError } from "../api.js";
import { MessageBubble } from "./MessageBubble.js";

export function Conversation({
  projectId,
  sessionId,
  onUnauthorized,
}: {
  projectId: string;
  sessionId: string;
  onUnauthorized: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchSession(projectId, sessionId)
      .then(setDetail)
      .catch((e) => {
        if (e instanceof UnauthorizedError) onUnauthorized();
        else setError("加载失败");
      })
      .finally(() => setLoading(false));
  }, [projectId, sessionId, onUnauthorized]);

  if (loading) return <div className="conv-empty">加载中…</div>;
  if (error) return <div className="conv-empty">{error}</div>;
  if (!detail) return null;

  return (
    <div className="conversation">
      <div className="conv-header">{detail.meta.title}</div>
      <div className="conv-stream">
        {detail.messages.map((m) => (
          <MessageBubble key={m.uuid} message={m} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/components/Conversation.tsx
git commit -m "feat(web): conversation view fetching and rendering a session"
```

---

### Task 19: 侧栏组件(可拖拽 + 可折叠 + 项目/session 列表 + 搜索)

侧栏拉取项目,展开看 session 列表;顶部搜索框切到搜索结果;宽度可拖拽,可整体折叠。

**Files:**
- Create: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: 写 `packages/web/src/components/Sidebar.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Project, SessionMeta, SearchHit } from "@cc-web/shared";
import { fetchProjects, fetchSessions, searchHistory, UnauthorizedError } from "../api.js";

export interface Selection {
  projectId: string;
  sessionId: string;
}

export function Sidebar({
  onSelect,
  onUnauthorized,
}: {
  onSelect: (sel: Selection) => void;
  onUnauthorized: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionMeta[]>>({});
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((e) => {
        if (e instanceof UnauthorizedError) onUnauthorized();
      });
  }, [onUnauthorized]);

  async function toggleProject(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!sessions[id]) {
      const list = await fetchSessions(id);
      setSessions((s) => ({ ...s, [id]: list }));
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setHits(await searchHistory(query));
  }

  return (
    <div className="sidebar-inner">
      <form className="sidebar-search" onSubmit={runSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索历史…"
        />
      </form>

      {hits !== null ? (
        <div className="search-results">
          <div className="sidebar-label">搜索结果 ({hits.length})</div>
          {hits.map((h, i) => (
            <button
              key={i}
              className="session-item"
              onClick={() => onSelect({ projectId: h.projectId, sessionId: h.sessionId })}
            >
              <div className="session-title">{h.sessionTitle}</div>
              <div className="session-snippet">{h.snippet}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="project-list">
          {projects.map((p) => (
            <div key={p.id} className="project-group">
              <button className="project-head" onClick={() => toggleProject(p.id)}>
                <span>{expanded === p.id ? "▾" : "▸"}</span>
                <span className="project-name" title={p.displayPath}>
                  {p.displayPath}
                </span>
                <span className="project-count">{p.sessionCount}</span>
              </button>
              {expanded === p.id &&
                (sessions[p.id] ?? []).map((s) => (
                  <button
                    key={s.id}
                    className="session-item"
                    onClick={() => onSelect({ projectId: p.id, sessionId: s.id })}
                  >
                    <div className="session-title">{s.title}</div>
                    <div className="session-time">{s.startedAt}</div>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/components/Sidebar.tsx
git commit -m "feat(web): sidebar with projects, sessions, and search"
```

---

### Task 20: App 顶层布局(拖拽/折叠/响应式抽屉)

组装登录态、侧栏、对话视图。桌面:可拖拽调宽 + 可折叠侧栏。手机:侧栏变抽屉(汉堡触发 + 遮罩)。

**Files:**
- Modify: `packages/web/src/App.tsx`(替换 Task 4 的占位)

- [ ] **Step 1: 重写 `packages/web/src/App.tsx`**

```tsx
import { useCallback, useRef, useState } from "react";
import { getToken, clearToken } from "./api.js";
import { LoginScreen } from "./auth.js";
import { Sidebar, type Selection } from "./components/Sidebar.js";
import { Conversation } from "./components/Conversation.js";

export function App() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [width, setWidth] = useState(300);
  const dragging = useRef(false);

  const onUnauthorized = useCallback(() => {
    clearToken();
    setAuthed(false);
  }, []);

  function startDrag() {
    dragging.current = true;
    const move = (e: MouseEvent) => {
      if (dragging.current) setWidth(Math.min(500, Math.max(200, e.clientX)));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;

  function selectAndClose(sel: Selection) {
    setSelection(sel);
    setDrawerOpen(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="hamburger" onClick={() => setDrawerOpen((v) => !v)}>
          ☰
        </button>
        <button className="collapse-btn" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "»" : "«"}
        </button>
        <span className="topbar-title">{selection ? "对话" : "cc-web"}</span>
      </header>

      <div className="body">
        {!collapsed && (
          <aside
            className={`sidebar ${drawerOpen ? "drawer-open" : ""}`}
            style={{ width }}
          >
            <Sidebar onSelect={selectAndClose} onUnauthorized={onUnauthorized} />
          </aside>
        )}
        {!collapsed && <div className="drag-handle" onMouseDown={startDrag} />}
        {drawerOpen && <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />}

        <main className="main">
          {selection ? (
            <Conversation
              projectId={selection.projectId}
              sessionId={selection.sessionId}
              onUnauthorized={onUnauthorized}
            />
          ) : (
            <div className="conv-empty">从左侧选择一个对话</div>
          )}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无 TS 错误,产物生成。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): app layout with draggable/collapsible sidebar and mobile drawer"
```

---

### Task 21: 样式(桌面 + 响应式手机)

全局样式:布局、气泡、折叠条、侧栏、登录页;`@media` 在窄屏把侧栏变抽屉。

**Files:**
- Create: `packages/web/src/styles.css`
- Modify: `packages/web/src/main.tsx`(引入样式)

- [ ] **Step 1: 写 `packages/web/src/styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; }

.app { display: flex; flex-direction: column; height: 100vh; }
.topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid #e3e3e3; background: #fafafa;
}
.topbar-title { font-weight: 600; }
.hamburger { display: none; }
.body { display: flex; flex: 1; min-height: 0; position: relative; }

.sidebar { border-right: 1px solid #e3e3e3; overflow-y: auto; background: #f7f7f8; flex-shrink: 0; }
.sidebar-inner { padding: 8px; }
.sidebar-search input { width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; }
.sidebar-label { font-size: 12px; color: #888; margin: 8px 4px; text-transform: uppercase; }

.project-head, .session-item {
  display: block; width: 100%; text-align: left; background: none;
  border: none; padding: 6px 8px; cursor: pointer; border-radius: 6px;
}
.project-head { display: flex; gap: 6px; align-items: center; font-weight: 600; }
.project-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-count { color: #999; font-size: 12px; }
.session-item:hover, .project-head:hover { background: #ececef; }
.session-title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-time, .session-snippet { font-size: 12px; color: #999; }

.drag-handle { width: 5px; cursor: col-resize; background: transparent; }
.drag-handle:hover { background: #d0d0d5; }

.main { flex: 1; min-width: 0; overflow-y: auto; }
.conv-empty { padding: 40px; color: #999; text-align: center; }
.conversation { display: flex; flex-direction: column; }
.conv-header { padding: 12px 16px; border-bottom: 1px solid #eee; font-weight: 600; }
.conv-stream { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

.bubble { padding: 10px 14px; border-radius: 10px; max-width: 80%; }
.bubble-user { align-self: flex-end; background: #d9eaff; }
.bubble-assistant { align-self: flex-start; background: #f1f1f3; }
.bubble-model { font-size: 11px; color: #888; margin-bottom: 4px; }
.block-text { white-space: pre-wrap; }
.block-pre { white-space: pre-wrap; font-size: 12px; background: #fff; padding: 8px; border-radius: 6px; overflow-x: auto; }

.collapsible { margin: 6px 0; border: 1px solid #e3e3e3; border-radius: 6px; }
.collapsible-head {
  display: flex; gap: 6px; align-items: center; width: 100%;
  background: #fafafa; border: none; padding: 6px 8px; cursor: pointer; border-radius: 6px;
}
.collapsible-summary { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collapsible.error .collapsible-status { color: #c00; }
.collapsible.ok .collapsible-status { color: #090; }
.collapsible-body { padding: 8px; }

.login { display: flex; align-items: center; justify-content: center; height: 100vh; background: #f7f7f8; }
.login-card { display: flex; flex-direction: column; gap: 10px; padding: 28px; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); width: 280px; }
.login-card h1 { margin: 0; }
.login-sub { margin: 0; color: #888; font-size: 14px; }
.login-card input { padding: 8px; border: 1px solid #ddd; border-radius: 6px; }
.login-card button { padding: 8px; border: none; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
.login-card button:disabled { opacity: 0.5; cursor: default; }
.login-error { color: #c00; font-size: 13px; margin: 0; }

.drawer-overlay { display: none; }

@media (max-width: 768px) {
  .hamburger { display: inline-block; }
  .collapse-btn { display: none; }
  .drag-handle { display: none; }
  .sidebar {
    position: absolute; top: 0; left: 0; bottom: 0; z-index: 20;
    width: 80% !important; transform: translateX(-100%); transition: transform 0.2s;
  }
  .sidebar.drawer-open { transform: translateX(0); }
  .drawer-overlay { display: block; position: absolute; inset: 0; background: rgba(0,0,0,0.3); z-index: 10; }
  .bubble { max-width: 92%; }
}
```

- [ ] **Step 2: 在 `packages/web/src/main.tsx` 顶部引入样式**

在现有 import 之后加一行:

```tsx
import "./styles.css";
```

- [ ] **Step 3: 构建验证**

Run: `npm run build --workspace @cc-web/web`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/styles.css packages/web/src/main.tsx
git commit -m "feat(web): global styles with responsive mobile drawer"
```

---

### Task 22: 端到端手动验证

同时跑前后端,真机/浏览器验证浏览全链路。

- [ ] **Step 1: 起后端**

Run: `AUTH_TOKEN=dev npm run dev:server`(根目录)
Expected: 打印监听 `http://localhost:3000`,serving history 指向真实 `~/.claude/projects`。

- [ ] **Step 2: 起前端(另一个终端)**

Run: `npm run dev:web`
Expected: Vite 打印本地地址(默认 `http://localhost:5173`)。

- [ ] **Step 3: 浏览器验证清单**

打开 Vite 地址,逐项确认:
- 登录页出现 → 输入 `dev` → 进入主界面(错误 token 应报"令牌错误")。
- 侧栏列出真实项目;点项目展开看到 session 列表(标题来自 ai-title 或首条 user 消息)。
- 点 session → 右侧渲染消息流;`thinking`/`tool` 默认折叠,点击展开。
- 顶部搜索框输关键字 → 显示搜索结果,点结果跳到对应 session。
- 拖动侧栏与主区之间的手柄 → 宽度变化;点「«」→ 侧栏折叠。
- 手机宽度(或 DevTools 设备模拟)→ 出现汉堡 ☰,点开抽屉式侧栏,选 session 后抽屉关闭。

- [ ] **Step 4: 跑一次全量测试与构建作为收尾**

Run: `npm test && npm run build`(根目录,经 workspaces 分发)
Expected: server 全部单测/集成测试 PASS;shared/server/web 全部构建成功。

> 此步无新增提交(仅验证)。如验证中发现问题,回到对应 Task 修复并提交。

---

## 自检(计划 vs spec)

- **第 1 节(目标/范围/MVP)**:浏览历史 ✓(Task 8/18/19)、搜索历史 ✓(Task 9/19);续聊/新建/手机答题属计划二,本计划范围已在头部声明。
- **第 2 节(架构)**:三层 monorepo ✓(Task 1-4);REST(本计划)✓,SSE 留计划二。
- **第 4 节(数据层)**:JSONL 解析 ✓(Task 6)、标题提取 ✓(Task 7)、目录遍历 ✓(Task 8)、搜索 ✓(Task 9)。
- **第 5 节(API)**:`/api/auth`/`/api/projects`/`/api/projects/:id/sessions`/`/api/sessions/:id`/`/api/search` ✓(Task 11/12);`continue`/`new`/`stream`/`respond` 留计划二。
- **第 6 节(UI)**:可拖拽/可折叠侧栏 ✓(Task 19/20)、桌面布局 ✓、手机抽屉 ✓(Task 20/21)、折叠区块 ✓(Task 16/17);附件上传与交互卡片属续聊,留计划二。
- **第 9 节(安全)**:鉴权中间件 ✓(Task 11)、路径穿越防护 ✓(Task 8);HTTPS 为部署建议,文档已述。
- **第 10 节(测试)**:Vitest 单测(jsonl/title/store/search/config/auth)✓、supertest 集成(routes)✓、手动验证 ✓(Task 22)。
- **第 11/12 节(monorepo/技术栈)**:npm workspaces + 三包 + TS + Vite + Vitest ✓(Task 1-4)。

类型一致性:`Project`/`SessionMeta`/`Message`/`ContentBlock`(`kind` 判别联合)/`SessionDetail`/`SearchHit`/`AuthResponse` 在 Task 5 定义,server(Task 6-12)与 web(Task 14-20)引用一致;`createApp(config)` 签名在 Task 12 定义、Task 13 与 routes.test 一致;`listProjects/listSessions/readSession`、`search`、`parseLine`、`extractTitle`、`loadConfig`、`requireAuth/authRoute` 命名前后统一。

无占位符:所有代码步骤含完整可运行代码与确切命令。
