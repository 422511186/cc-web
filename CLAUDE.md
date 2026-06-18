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

- **不允许跳过“先写测试”这一步。** 不得先写实现再补测试，不得“等会儿再加测试”。
- **每次需求变更同样走 TDD。** 需求改变时，先改/加测试表达新需求并使其失败，再改实现。
- 在动手写任何产品代码（`src/**/*.ts`、`src/**/*.tsx`，但不含 `*.test.*`）之前，必须先存在对应的失败测试。
- 提交前所有测试必须为绿色（见下方测试命令）。
- 若用户要求“快速改一下、先不写测试”，仍需说明本仓库强制 TDD，并坚持先写测试；这是硬性要求，不是建议。

执行方式：开始任何编码任务前，先调用 `superpowers:test-driven-development` 技能并按其流程操作。

## 项目概述

cc-web 把本地 Claude Code 的聊天搬上 Web：既能浏览历史聊天记录，也能在网页（含手机）里**接管并续聊**同一个会话。设计文档见 `docs/superpowers/specs/`（`2026-06-14-cc-web-design.md` 历史浏览、`2026-06-14-cc-web-realtime-conversation-design.md` 实时续聊）。

两条主线均已实现：

- **计划一·历史浏览**：项目 → session → 消息浏览、全文搜索、标题提取、JSONL 解析、删除历史会话、粘贴图片读取、SSE 文件变更推送、令牌鉴权、React 前端（含手机响应式布局）。
- **计划二·实时续聊**：通过 `@anthropic-ai/claude-agent-sdk` 续聊/新建会话，逐字流式输出，交互式答题（AskUserQuestion）、权限确认（canUseTool）、计划审批（ExitPlanMode）卡片，附件上传，停止/分离/重连接管。

> 关键定位：Web 续聊的本质是**远程接管同一个活跃会话**（后端单例 SessionManager 池），不是另起一个 resume 历史的独立进程。切走时忙碌则保活、空闲则回收。

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
# 在某个包内运行全部测试
npm test --workspace @cc-web/server
npm test --workspace @cc-web/web
npm test --workspace @cc-web/shared

# 监听模式（TDD 时常用）
npm run test:watch --workspace @cc-web/server

# 运行单个测试文件 / 单个用例(Vitest)。注意:--workspace 是 npm 的参数,
# 不能传给 vitest;跑单文件/单用例请先 cd 进对应包再调 vitest:
cd packages/server && npx vitest run src/jsonl.test.ts
cd packages/server && npx vitest run -t "should parse user messages"
```

后端运行所需环境变量（`AUTH_TOKEN` 必填，缺失会启动失败）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | （必填） | 单一访问令牌；缺失则 `loadConfig` 抛错、启动失败 |
| `PORT` | `3000`（dev 用 3002） | 监听端口 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | 历史记录根目录 |
| `CLAUDE_IMAGE_CACHE_DIR` | `<projects 同级>/image-cache` | 粘贴图片缓存目录（`/api/image` 只读这里） |
| `PERMISSION_MODE` | `default` | `default` / `acceptEdits` / `bypassPermissions`（非 default 高风险，危险操作不再确认） |
| `SESSION_IDLE_TIMEOUT_MS` | `180000`（3 分钟） | 活跃会话空闲超时；执行/产出事件会续期 |
| `MAX_CONCURRENT_SESSIONS` | `3` | 活跃 agent 并发上限；超限新建/续聊返回 409，需先关闭已有 agent |
| `UPLOADS_DIR` | `<cwd>/uploads` | 附件上传保存目录 |

Windows 下可直接用根目录的 `start-server.bat` / `start-web.bat`（已预设上述变量，`AUTH_TOKEN=test-token-123456` 为开发令牌）。

## 架构

### Monorepo（npm workspaces）

三个包，核心动机是**前后端共享 TypeScript 类型**，避免 API 契约漂移：

- `packages/shared`（`@cc-web/shared`）：共享类型与契约。`types.ts` 领域模型、`api.ts` REST 请求/响应类型、`events.ts`（续聊核心契约：`ServerEvent` SSE 事件、`PendingPrompt` 待答事项、`PromptAnswer` 回答）。会被编译成 `dist/`，server 与 web 通过 `dist` 的类型声明引用它。**改了 shared 后需重新构建**才能让其它包拿到最新类型。
- `packages/server`（`@cc-web/server`）：Node + Express 后端。
- `packages/web`（`@cc-web/web`）：React + Vite 前端。

TS 项目引用（project references）：server/web 的 `tsconfig.json` 都 `references` shared，根 `tsconfig.base.json` 为共享基础配置（`composite`、`strict`、ES2022）。

### 后端（packages/server/src）

后端分两层：**计划一只读历史 JSONL（无数据库）**，**计划二用 Agent SDK 跑活跃会话**。

入口与装配：

- `index.ts`：入口。加载配置 → 创建 `SessionStore` → `SSEManager` → `SessionWatcher`，为每个项目启动文件监听 → `createApp` 装配 Express → `listen` + 优雅关停。
- `app.ts`：`createApp(config, store, sseManager?, sdkClient?)` 组装应用——`express.json({limit:'5mb'})` → `/api` 鉴权中间件 → 浏览路由 → `SessionManager` + 续聊路由 → 上传路由。`sdkClient` 可注入，**测试传 fake 以免真起 claude**。
- `config.ts`：从环境变量加载配置，`AUTH_TOKEN` 缺失则抛错。
- `auth.ts`：Bearer 鉴权中间件，前置于所有 `/api` 路由。

计划一·历史浏览：

- `store.ts`：`SessionStore`，封装对 projects 目录的读取——`listProjects`（目录名即编码过的项目路径，如 `C--Users-huang-Desktop`）、`listSessions`、`getSession`、`deleteSession`、`getSessionCwd`（从 JSONL 读会话真实工作目录，供续聊定位 resume）。
- `jsonl.ts`：JSONL 解析器。逐行解析，过滤可展示消息（user/assistant/text/thinking），跳过噪音类型，thinking 块拆成独立消息，容错损坏行/空文件。
- `title.ts`：从 session 第一条 user 消息提取标题。
- `search.ts`：内存全文扫描搜索。
- `sse.ts`：`SSEManager`，管理浏览用 SSE 客户端连接，30 秒 keep-alive ping，文件变更时 `notifySessionUpdate` 广播 `session-update` 事件。
- `watcher.ts`：`SessionWatcher`，轮询（每秒）各项目目录 jsonl 文件 mtime，检测到新增/变更则通过 `SSEManager` 推送。
- `routes.ts`：浏览 REST + SSE 路由（`/events` SSE、`/projects`、`/projects/:id/sessions`、`DELETE /projects/:id/sessions/:sid`、`/sessions/:id`、`/search`、`/image` 受限于 imageCacheDir 防穿越）。

计划二·实时续聊（Agent SDK 层）：

- `sdk.ts`：`SdkClient` 窄接口（只暴露 `start()`）+ `realSdkClient` 真实适配器，转调 SDK `query()`。关键选项：续聊传 `resume` 且 `forkSession:false`（续写原会话不分叉）、`includePartialMessages:true`（逐字流）、注入 `canUseTool` 与 `abortController`。**测试注入 fake SdkClient**，不真起 claude。
- `session.ts`：`Session`——单个活跃会话状态机。持有 `InputQueue`（喂 SDK 的 prompt）、`PendingRegistry`（挂起等用户回答）、`AbortController`。消费 SDK 输出翻译成 `ServerEvent`（delta/block/run_info/turn_end/status…），`canUseTool` 把工具调用映射成 question/plan/permission 待答事项并挂起。`isBusy()`=执行中或有待答项。两种收尾：`detach()`（优雅，不 abort，发 `closed:detached`，后台跑完自然退出）vs `close()`（abort，发 `closed`）。
- `sessionManager.ts`：`SessionManager`——活跃会话池，带 `maxConcurrent` 并发上限与 `idleTimeoutMs` 空闲超时（产出事件会 `touch` 续期）。`startNew` 随机 runId；`startContinue` **复用 sessionId 作 runId**。`release()` 切走时忙碌保活、空闲 `detach`。`runToCompletion().finally` 回收时做**实例相等校验**（`entries.get(runId)?.session === session`），避免误杀同 runId 重建的新会话。
- `chatRoutes.ts`：续聊 REST + 流式 SSE。每个 runId 一个 **Hub**（append-only 事件日志 + SSE 通道 + `HUB_GRACE_MS=60s` 宽限）。路由：`POST /sessions/new`、`POST /sessions/:id/continue`（先 `resetHub` 清残留终态事件，再 `startContinue`）、`POST /sessions/:runId/message`、`/respond`、`/abort`、`DELETE /sessions/:runId`（detach）、`GET /sessions/:runId/stream`（SSE，重连整段重放事件日志）。
- `inputQueue.ts`：`InputQueue`，AsyncIterable，把用户消息逐条喂给 SDK prompt；`close()` 让迭代结束。
- `pending.ts`：`PendingRegistry`，登记待答项返回 `{id, promise}`，`settle(id, answer)` 兑现、`rejectAll` 关闭时拒绝。
- `sseChannel.ts`：`SSEChannel`，单条 SSE 连接的写封装。
- `uploads.ts`：`createUploadRouter`，`POST /api/uploads` 接收附件存到 `UPLOADS_DIR`，返回引用。

注意：`*.test.ts` 在 server `tsconfig.json` 中被 `exclude`（测试由 Vitest 跑，不进构建产物）。

### 前端（packages/web/src）

- `App.tsx`：根组件。令牌存 `sessionStorage`，未登录显示 `Login`；用 URL query（`?project=&session=`）记录当前会话并支持刷新恢复。顶栏展示真实项目名与磁盘路径、连接状态（已连接/已结束/连接中…/未连接）。
- `useSession.ts`：把续聊 SSE 流（`GET /sessions/:runId/stream`）归约成 `SessionState`（messages/pending/connected/status/model/closed/closedReason…）。runId 变化时复位上一会话终态，`onopen` 复位 closed，收到 `closed` 事件置终态。
- `chatApi.ts`：续聊 REST 封装（`startNew`/`startContinue`/`sendMessage`/`respond`/`closeSession`/`abortSession`/`uploadFile`），带 Bearer 头。`closeSession` 用 `keepalive` 让卸载时仍能发出、失败静默。
- `api.ts`：`createApiClient(token)`，浏览类请求封装。
- `components/`：`Login`、`Sidebar`（项目/会话列表 + 搜索）、`Conversation`（消息流）、`MobileMenu`（手机抽屉侧栏）、`Composer`（输入框 + 附件）、`QuestionCard`/`PermissionCard`/`PlanCard`（三类待答卡片）、`ConfirmDialog`/`AlertDialog`、`DiffView`/`AttachmentPreview`。
- `diff.ts`：文本 diff 计算（供 DiffView 渲染工具改动）。
- 响应式：`responsive.css` 负责手机布局，`markdown.css` 负责消息内容渲染。
- 测试用 Vitest + jsdom + Testing Library，setup 在 `src/test/setup.ts`；`*.test.tsx` 在 `tsconfig.json` 中被 `exclude`（构建用，测试单独跑）。

### 前后端通信

- 浏览/搜索：普通 REST（GET）。
- 文件变更通知：浏览 SSE（`GET /api/events`，单向后端→前端，自动重连）。EventSource 不支持自定义头，鉴权通过中间件处理。
- 续聊：`POST` 提交消息/回答/控制，`GET /api/sessions/:runId/stream` 用 SSE 接收流式回复与待答事项。**重连会整段重放事件日志**，故前端归约需对重复事件幂等、并以最后一个 `status`/`closed` 为准。

## 测试约定

- 测试框架：**Vitest**（三包统一），开启 `globals`，无需 import `describe/it/expect`（已在 tsconfig `types` 中声明）。
- 后端浏览层用 `supertest` 打 Express 路由 + mock 文件系统数据；续聊层注入 **fake SdkClient**（可控流：让某轮挂起/永不结束以测竞态），避免真起 claude。
- 前端用 jsdom + `@testing-library/react`；续聊 hook 用 `renderHook` + mock SSE/EventSource。
- 测试文件与被测文件同目录，命名 `*.test.ts` / `*.test.tsx`。
- 写测试时优先参考已有同类测试（如 `jsonl.test.ts`、`sessionManager.test.ts`、`App.test.tsx`、`useSession.test.ts`）的风格与结构。

## 注意事项

- **远程接管是最高风险点**：连上即可在本机执行命令/改文件。`PERMISSION_MODE` 非 `default` 时危险操作不再确认，远程务必谨慎。
- **续聊复用 sessionId 作 runId** 是核心坑：新旧会话/Hub 可能在同一 runId 上碰撞。已有两处防护必须保留——(1) `sessionManager` 的 `finally` 回收做实例相等校验，避免误杀重建的新会话；(2) `chatRoutes` 在 `continue` 前 `resetHub`，清掉上一轮残留的 `closed` 事件，否则重连重放会让前端误判「已结束 / 永久连接中」。
- **推理强度（effort）不可得**：SDK 输出流与历史 JSONL 都不携带 effort（它只是输入项），前端据此展示「不可用」。`run_info` 通常只有 model。
- 解析历史/读图片时只读 `CLAUDE_PROJECTS_DIR` / imageCacheDir 下文件，注意防目录穿越。
- 改动 shared 类型后记得 `npm run build`（或至少构建 shared），否则 server/web 拿到的是旧类型。
- “请求很慢”先查端口冲突：游离 Vite 进程可能占住后端 3002（IPv6 `::1`），先 `netstat` 排查，别先怀疑 SDK。

## 文档维护规则

**⚠️ 重要：需求变更或新增功能后，必须检查并更新相关文档。**

任何代码变更完成后，检查是否需要同步更新以下文档：

1. **CLAUDE.md**（本文档）：
   - 新增/修改 API 路由 → 更新「架构」或「前后端通信」章节
   - 新增环境变量 → 更新「常用命令」中的环境变量表
   - 架构调整（新增模块、重命名） → 更新「架构」章节
   - 新增注意事项/坑点 → 补充到「注意事项」

2. **docs/TECH-DEBT.md**（技术债务）：
   - 修复 P0/P1/P2 问题 → 标注已修复或删除对应条目
   - 发现新的 bug/边界条件 → 新增条目
   - 完成改进项 → 从列表中移除

3. **docs/superpowers/specs/DESIGN-EVOLUTION.md**（设计演进）：
   - 重大架构调整（如改变生命周期机制、事件类型） → 新增演进记录
   - 实现了「未实现功能」（如 DiffBuilder） → 更新状态
   - 术语变更 → 更新术语对照表

4. **docs/superpowers/specs/2026-06-14-cc-web-design.md**（总体设计）：
   - 新增功能超出原设计范围 → 补充到相关章节
   - 配置项变更 → 更新第 7 节配置表

5. **docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md**（实时续聊设计）：
   - 修改 SSE 事件类型 → 更新第 10 节
   - API 路径变更 → 更新第 9 节

**强制规则**：
- 代码变更 PR 合并前，必须完成相关文档更新
- 如无法确定是否需要更新，默认更新（宁可冗余，不可遗漏）
- 文档更新应包含在同一个 commit 中，提交信息注明「docs: 同步更新 xxx 文档」

**检查清单**（变更后自查）：
- [ ] 是否新增/修改了 API 路由？ → 更新 CLAUDE.md + 设计文档
- [ ] 是否新增/修改了环境变量？ → 更新 CLAUDE.md 环境变量表
- [ ] 是否调整了架构/模块命名？ → 更新 CLAUDE.md + DESIGN-EVOLUTION.md
- [ ] 是否修复了 TECH-DEBT.md 中的问题？ → 标注或删除对应条目
- [ ] 是否发现了新的技术债务？ → 补充到 TECH-DEBT.md
- [ ] 是否实现了「未实现功能」？ → 更新 DESIGN-EVOLUTION.md 状态
- [ ] 是否修改了 SSE 事件类型或前后端契约？ → 更新实时续聊设计文档
