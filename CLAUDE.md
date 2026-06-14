# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本文档为中文。后续所有交流、文档、提交说明也尽量使用中文。

## 🔴 最高优先级：强制 TDD（不可绕过）

**本仓库的所有开发都必须使用 `superpowers:test-driven-development` 技能，严禁绕过 TDD。**

任何**新增功能、修改功能或修复 bug**，都必须严格遵循 TDD 三步循环（RED → GREEN → REFACTOR）：

1. **RED — 先写失败测试**：先写一个能表达需求的测试，运行它，**亲眼确认它失败**（且失败原因符合预期，而非编译/导入错误）。
2. **GREEN — 写最小实现让测试通过**：只写让当前失败测试通过所需的最少代码，不提前实现未被测试覆盖的功能。
3. **REFACTOR — 重构**：在测试保持绿色的前提下清理代码、消除重复、改善命名。

强制约束：

- **不允许跳过"先写测试"这一步。** 不得先写实现再补测试，不得"等会儿再加测试"。
- **每次需求变更同样走 TDD。** 需求改变时，先改/加测试表达新需求并使其失败，再改实现。
- 在动手写任何产品代码（`src/**/*.ts`、`src/**/*.tsx`，但不含 `*.test.*`）之前，必须先存在对应的失败测试。
- 提交前所有测试必须为绿色（见下方测试命令）。
- 若用户要求"快速改一下、先不写测试"，仍需说明本仓库强制 TDD，并坚持先写测试；这是硬性要求，不是建议。

执行方式：开始任何编码任务前，先调用 `superpowers:test-driven-development` 技能并按其流程操作。

## 项目概述

cc-web 把本地 Claude Code 的聊天搬上 Web，支持浏览历史聊天记录，并（规划中）在网页（含手机）里继续对话。完整设计见 `docs/superpowers/specs/2026-06-14-cc-web-design.md`。

当前已实现：历史浏览（项目 → session → 消息）、全文搜索、会话标题提取、JSONL 解析、SSE 文件变更推送、令牌鉴权、React 前端（含手机响应式布局）。规划中：通过 Agent SDK 续聊、交互式问答/权限确认/计划审批卡片。

## 常用命令

在仓库根目录运行（npm workspaces）：

```bash
# 安装依赖
npm install

# 构建全部包（shared 必须先构建，server/web 依赖它的 dist 类型）
npm run build

# 运行全部包的测试
npm test

# 开发模式
npm run dev:server   # 启动后端（tsx watch，需要环境变量，见下）
npm run dev:web      # 启动前端 Vite dev server（端口 3000，/api 代理到 3002）
```

针对单个包：

```bash
# 在某个包内运行测试
npm test --workspace @cc-web/server
npm test --workspace @cc-web/web
npm test --workspace @cc-web/shared

# 监听模式（TDD 时常用）
npm run test:watch --workspace @cc-web/server

# 运行单个测试文件 / 单个用例（Vitest）
npx vitest run src/jsonl.test.ts --workspace @cc-web/server
npx vitest run -t "should parse user messages" --workspace @cc-web/server
```

后端运行所需环境变量（`AUTH_TOKEN` 必填，缺失会启动失败）：

```bash
AUTH_TOKEN=test-token-123      # 必填，单一访问令牌
PORT=3002                      # 默认 3000
CLAUDE_PROJECTS_DIR=~/.claude/projects   # 历史记录根目录
PERMISSION_MODE=default        # default / acceptEdits / bypassPermissions（非 default 高风险）
```

Windows 下可直接用根目录的 `start-server.bat` / `start-web.bat`（已预设上述变量）。

## 架构

### Monorepo（npm workspaces）

三个包，核心动机是**前后端共享 TypeScript 类型**，避免 API 契约漂移：

- `packages/shared`（`@cc-web/shared`）：共享类型与契约（`types.ts` 领域模型、`api.ts` REST 请求/响应类型）。会被编译成 `dist/`，server 与 web 通过 `dist` 的类型声明引用它。**改了 shared 后需重新构建**才能让其它包拿到最新类型。
- `packages/server`（`@cc-web/server`）：Node + Express 后端。
- `packages/web`（`@cc-web/web`）：React + Vite 前端。

TS 项目引用（project references）：server/web 的 `tsconfig.json` 都 `references` shared，根 `tsconfig.base.json` 为共享基础配置（`composite`、`strict`、ES2022）。

### 后端（packages/server/src）

数据层**不使用数据库**，直接读 `~/.claude/projects/**/*.jsonl`：

- `index.ts`：入口。加载配置 → 创建 `SessionStore` → `SSEManager` → `SessionWatcher`，为每个项目启动文件监听 → 装配 Express（`express.json()` → `/api` 鉴权中间件 → 路由）。
- `config.ts`：从环境变量加载配置，`AUTH_TOKEN` 缺失则抛错。
- `auth.ts`：鉴权中间件，前置于所有 `/api` 路由。
- `store.ts`：`SessionStore`，封装对 projects 目录的读取——`listProjects`（目录名即编码过的项目路径，如 `C--Users-huang-Desktop`）、`listSessions`、`getSession`。
- `jsonl.ts`：JSONL 解析器。逐行解析，过滤可展示消息（user/assistant/text/thinking），跳过噪音类型，thinking 块拆成独立消息，容错损坏行/空文件。
- `title.ts`：从 session 第一条 user 消息提取标题。
- `search.ts`：内存全文扫描搜索。
- `sse.ts`：`SSEManager`，管理 SSE 客户端连接，30 秒 keep-alive ping，文件变更时 `notifySessionUpdate` 广播 `session-update` 事件。
- `watcher.ts`：`SessionWatcher`，轮询（每秒）各项目目录 jsonl 文件 mtime，检测到新增/变更则通过 `SSEManager` 推送。
- `routes.ts`：REST + SSE 路由（`/events` SSE、`/projects`、`/projects/:id/sessions`、`/sessions/:id`、`/search`）。

注意：`*.test.ts` 在 server `tsconfig.json` 中被 `exclude`（测试由 Vitest 跑，不进构建产物）。

### 前端（packages/web/src）

- `App.tsx`：根组件。令牌存 `sessionStorage`，未登录显示 `Login`；用 URL query（`?project=&session=`）记录当前会话并支持刷新恢复。
- `components/`：`Login`、`Sidebar`（项目/会话列表 + 搜索）、`Conversation`（消息流）、`MobileMenu`（手机抽屉式侧栏）。
- `api.ts`：`createApiClient(token)`，封装带鉴权头的请求。
- 响应式：`responsive.css` 负责手机布局，`markdown.css` 负责消息内容渲染。
- 测试用 Vitest + jsdom + Testing Library，setup 在 `src/test/setup.ts`；`*.test.tsx` 在 `tsconfig.json` 中被 `exclude`（构建用，测试单独跑）。

### 前后端通信

- 浏览/搜索：普通 REST（GET）。
- 文件变更通知：SSE（`GET /api/events`，单向后端→前端，自动重连）。EventSource 不支持自定义头，鉴权通过中间件处理。
- 续聊/答题（规划中）：POST 提交，SSE 接收流式回复与待答事项。

## 测试约定

- 测试框架：**Vitest**（三包统一），开启 `globals`，无需 import `describe/it/expect`（已在 tsconfig `types` 中声明）。
- 后端集成测试用 `supertest` 打 Express 路由，用 mock 文件系统数据。
- 前端用 jsdom + `@testing-library/react`。
- 测试文件与被测文件同目录，命名 `*.test.ts` / `*.test.tsx`。
- 写测试时优先参考已有同类测试（如 `jsonl.test.ts`、`App.test.tsx`）的风格与结构。

## 注意事项

- 远程访问是高风险点（连上即可执行命令/改文件）。`PERMISSION_MODE` 非 `default` 时危险操作不再确认，远程务必谨慎。
- 解析历史时只读 `CLAUDE_PROJECTS_DIR` 下文件，注意防目录穿越。
- 改动 shared 类型后记得 `npm run build`（或至少构建 shared），否则 server/web 拿到的是旧类型。
