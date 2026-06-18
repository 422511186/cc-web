# cc-web 实时续聊与确认交互设计

- 日期: 2026-06-14（初版）
- 最后更新: 2026-06-18
- 状态: ✅ 已实现，文档已根据实际代码更新
- 原型: `.superpowers/brainstorm/4760-1781450740/content/cc-web-prototype.html`

> **重要**: 本文档描述的架构已全面实现，但部分模块命名、API 路径、事件类型与初版设计有差异。详见 [DESIGN-EVOLUTION.md](./DESIGN-EVOLUTION.md) 设计演进记录。

## 1. 目标

把本地 Claude Code 的历史会话继续提问能力搬到 Web 端。用户在浏览历史 session 时，可以直接在同一页面继续输入；Claude 的回复、权限确认、AskUserQuestion、计划审批和文件 diff 都以结构化 Web UI 展示。

本期只面向本机 / 局域网手机访问，不做公网服务、多用户账号、云同步或远程穿透。

## 2. 已确认的产品决策

- 历史浏览和实时续聊使用同一个 Conversation 页面。
- 打开历史 session 后，底部输入框直接可用；第一次发送时后端自动 resume 原 Claude Code session。
- 使用 Claude Code Agent SDK 接入实时会话，不用 PTY 复刻 CLI 终端。
- 侧边栏已有项目目录时，应支持直接快速新建，不再要求用户重复输入路径。
- Web 端要把“后台运行”做成一等能力：可见、可接管、可关闭，并受并发上限约束；用户不需要理解 SDK agent / runId 的实现细节。
- 权限确认、AskUserQuestion、计划审批都显示为对话流中的交互卡片。
- diff 视图放在权限确认卡片内展开，用户可以先看变更再允许或拒绝。
- 手机端接受“摘要 + 卡片 + 折叠 diff + 代码区横向滚动”的展示方式。

## 3. 复用现有代码

当前代码可以继续作为基础：

- `packages/server/src/store.ts`: 读取 `~/.claude/projects/**/*.jsonl`，列项目、列 session、读取会话。
- `packages/server/src/jsonl.ts`: 解析历史消息，包含 text、thinking、tool use/result 等展示数据。
- `packages/server/src/search.ts` 和 `title.ts`: 搜索与标题生成。
- `packages/server/src/auth.ts` 和 `config.ts`: 单 token 鉴权与环境配置。
- `packages/server/src/routes.ts`: 保留历史浏览 API，追加实时对话 API。
- `packages/server/src/sse.ts`: 扩展为 typed SSE 事件推送。
- `packages/web/src/App.tsx`: 登录、选 session、URL 恢复当前会话。
- `packages/web/src/components/Sidebar.tsx` 和 `MobileMenu.tsx`: 桌面侧栏和手机抽屉。
- `packages/web/src/components/Conversation.tsx`: 消息展示、Markdown、图片、thinking/tool 折叠。

## 4. 架构

> **实际实现**: 模块命名与设计文档有差异，见下方标注。

```text
React Web
  | REST: 发消息 / 提交交互结果
  | SSE: 回复流 / 工具事件 / 待答卡片
  v
Node Express
  - SessionStore: 历史 JSONL 读取 ✓
  - SessionManager: 活跃会话池管理（实际命名，非 ClaudeSessionManager）
  - ActiveAgent list: 以后端枚举作为活跃 run 真相源
  - PendingRegistry: 待答项登记表（实际命名，非 InteractionManager）
  - Hub: 事件中枢（append-only 日志 + 60s 宽限 + 整段重放）
  - [DiffBuilder: ✅ 已实现轻量版 unified diff 预览]
  v
Claude Code Agent SDK
  v
本地 Claude Code 进程
```

后端继续直接读取历史 JSONL。实时续聊时，后端用 Agent SDK resume 原 session，并把前端输入通过 async iterable (`InputQueue`) 送入 SDK。

## 5. 历史会话继续提问

> **实际实现**: 续聊时 `runId` 复用原 `sessionId`，URL 路径使用 `runId` 而非 `sessionId`。

用户打开历史 session 后看到完整历史消息。底部输入框始终显示。

发送第一条新消息时：

1. 前端调用 `POST /api/sessions/:sessionId/continue`（带 `projectId`），后端返回 `{runId: sessionId}`（**续聊时 runId 复用 sessionId**）
2. 后端 `SessionManager.startContinue()` 创建活跃会话，使用 Agent SDK resume 原 sessionId，并设置原项目工作目录
3. 前端建立 SSE 连接：`GET /api/sessions/:runId/stream`，订阅流式输出
4. 前端发送消息：`POST /api/sessions/:runId/message`（带 `text` + 可选 `attachments`）
5. 用户消息写入 `InputQueue`（async iterable），SDK 消费并输出通过 SSE 推回前端

**关键机制**: 
- **Hub 整段重放**: 前端切走再切回时，SSE 重连会重放完整事件日志（`hub.log`），保证状态完整
- **resetHub 碰撞防护**: 续聊前清掉上一轮残留 Hub（含旧 `closed` 事件），避免重放出旧终态

前端可以在历史消息和新消息之间显示一条轻量分隔线：

```text
继续于 2026-06-14 23:16
```

## 6. 对话展示

同一个时间线中展示历史消息和实时事件：

- user: 右侧气泡。
- assistant: Markdown 正文，实时回复时流式追加。
- thinking: 默认折叠，显示摘要。
- tool use/result: 默认折叠，显示工具名、状态、关键参数。
- permission: 权限确认卡片，显示工具、风险摘要、允许/拒绝按钮。
- AskUserQuestion: 问题卡片，支持单选和多选。
- plan approval: 计划审批卡片，支持批准或要求修改。
- diff: 放在权限确认卡片和工具结果卡片内，按文件分组。

## 7. Diff 视图

> **实际状态**: ✅ **已实现轻量版**。权限卡片会对 Edit / Write 工具展示 unified diff 预览；复杂差异合并策略仍可继续增强。

**原设计**: MVP 采用 unified diff，不做 split diff。

**计划支持来源**：
- `Edit`: 从 `old_string` / `new_string` 生成局部 diff。
- `MultiEdit`: 每个 edit 生成 hunk，按文件合并展示。
- `Write`: 若能读取旧文件，则展示旧内容到新内容的 diff；若是新文件，展示新增文件 diff。

暂不解析普通 `Bash` 输出中的 diff；`Bash` 仍按工具日志展示。

**当前实现**:
- 服务端 `diffBuilder.ts` 从 Edit / Write 工具参数生成 unified diff
- `session.ts` 在权限确认时把 diff 挂到 `PermissionPrompt.diff`
- 前端 `PermissionCard.tsx` 直接渲染 diff 预览，并按 `+ / - / @@` 做基础行级着色
- `DiffView.tsx` 仍主要用于历史/工具详情里的结构化 diff 展示

**影响**: 用户在权限确认前已经可以预览主要编辑类改动；但 MultiEdit 的复杂上下文合并、读取旧文件后生成更精细 diff 等能力仍可继续增强。

**后续计划**: 见 `docs/TECH-DEBT.md` 第三阶段优化。

- `DiffViewer`: 接收文件 diff 列表，按文件展示 additions/deletions。
- 桌面端默认可展开完整 hunks。
- 手机端默认折叠文件，展开后代码区允许横向滚动。
- 大 diff 需要限制首屏高度，提供“展开更多”。

## 8. 后端模块

> **实际实现**: 模块命名与职责与设计有差异，见下方标注。

### SessionManager（实际命名，设计文档称 ClaudeSessionManager）

职责：

- 管理运行中的活跃会话池（`Map<runId, {session, timer}>`）
- 并发控制（`maxConcurrent`，默认 4）与空闲超时（`idleTimeoutMs`，默认 3 分钟）
- 按 `sessionId` resume 历史会话（`startContinue`，**runId 复用 sessionId**）
- 创建新会话（`startNew`，runId 为随机 UUID）
- 枚举当前后台运行（`listActiveAgents()`，供 Web 侧边栏快速接管与关闭）
- 维护用户输入 async queue（`InputQueue`）
- 将 SDK 输出转换成 SSE 事件（`ServerEvent`）
- 处理会话结束、空闲超时、强制中止
- **三种释放语义**: `release()`（忙碌保活/空闲回收）、`detach()`（优雅分离）、`close()`（强制中止）

### PendingRegistry（实际命名，设计文档称 InteractionManager）

职责：

- 管理待答项（`PendingPrompt`）的注册与解决
- 为权限确认、AskUserQuestion、计划审批生成唯一 `id`
- 通过 SSE 推送 `PromptEvent`（含待答卡片数据）
- 接收前端 `POST /api/sessions/:runId/respond` 后 `settle(id, answer)` 解决对应 Promise
- 超时或 session 结束时 `rejectAll()` 清理 pending 状态

### Hub 事件中枢（设计文档未提及的核心机制）

每个 `runId` 在 `chatRoutes.ts` 中维护一个 Hub：

```typescript
interface Hub {
  log: ServerEvent[];        // 全量事件日志（append-only，直到宽限期到期）
  channel: SSEChannel | null; // 当前 SSE 连接
  closed: boolean;           // 是否已收到 closed 事件
  graceTimer: NodeJS.Timeout | null; // 60 秒宽限清理计时器
}
```

职责：
- 所有 `ServerEvent` 追加到 `log`，供前端重连时**整段重放**
- 实时有连接时双通道推送（`channel.send` + `log.push`）
- 会话结束后保留 60 秒宽限期（`HUB_GRACE_MS`）
- **`resetHub(sessionId)`**: 续聊前清掉旧 Hub，避免重放出旧 `closed` 事件

### ⚠️ DiffBuilder（已实现轻量版）

**设计职责**：
- 从 Agent SDK 工具 input/result 生成结构化 diff
- 隔离文件读取逻辑，避免前端理解工具 JSON
- 控制 diff 大小，避免超大文件拖垮前端

**实际状态**: 已实现轻量版 unified diff 生成，覆盖 Edit / Write 权限预览；尚未完全达到初版设计中更复杂的 diff 构建策略。

## 9. API

> **实际实现**: 路径参数使用 `runId`（运行时标识）而非 `sessionId`，`interactionId` 在请求体而非 URL。

保留现有 API：

```text
GET /api/projects
GET /api/projects/:projectId/sessions
GET /api/sessions/:sessionId?projectId=
GET /api/search?q=
GET /api/events                               # 浏览用 SSE（文件变更推送）
GET /api/image?path=
DELETE /api/projects/:projectId/sessions/:sessionId  # 删除历史会话
```

新增 API（实时续聊）：

```text
POST /api/sessions/new                        # 新建，返回 {runId: UUID}
POST /api/sessions/:sessionId/continue        # 续聊，返回 {runId: sessionId}（runId 复用）
GET  /api/sessions/:runId                     # 探活：确认 run 是否仍可接管
POST /api/sessions/:runId/message             # 发送消息（text + 可选 attachments）
POST /api/sessions/:runId/respond             # 提交答案（interactionId 在请求体）
GET  /api/sessions/active                     # 列出后台运行与上限
POST /api/sessions/:runId/abort               # 停止当前轮次执行（不关闭会话）
POST /api/sessions/:runId/close               # 强制关闭指定 agent
DELETE /api/sessions/:runId                   # 释放会话（忙碌保活 / 空闲回收）
GET  /api/sessions/:runId/stream              # SSE 流式输出（重连整段重放）
POST /api/uploads                             # 上传附件，返回 {ref, filename}
```

**关键差异**:
- 路径参数：续聊入口用 `sessionId`，运行时操作用 `runId`
- `respond` 路径简化：`/sessions/:runId/respond`（无 `/interactions/:id` 嵌套），`interactionId` 在请求体
- 新增 `abort` / `uploads` / `DELETE /sessions/:runId`

## 10. SSE 事件类型

> **实际实现**: 事件类型与设计完全不同，详见 `packages/shared/src/events.ts`。

**关键差异**:
- 所有事件**不携带 `sessionId`**（通过 SSE URL `/sessions/:runId/stream` 隐式绑定）
- 事件粒度更细，拆分流式增量与块级落定
- 新增状态机事件与用户消息回显

### 实际事件类型

```typescript
export type ServerEvent =
  | UserMessageEvent        // 用户消息回显（重连后仍可见自己发的消息）
  | DeltaEvent              // 流式增量（逐字追加）
  | BlockEvent              // 完整块落定（text/thinking/tool_use）
  | ToolResultEvent         // 工具执行结果
  | PromptEvent             // 待答事项（question/permission/plan）
  | TurnEndEvent            // 一轮对话结束
  | ErrorEvent              // 会话错误
  | ClosedEvent             // 会话终结（idle/aborted/exited/detached）
  | StatusEvent             // 状态机（idle/executing/waiting）
  | RunInfoEvent;           // 模型与推理强度信息
```

### 事件详细说明

**UserMessageEvent**
```typescript
{ type: 'user_message', text: string }
```
用户发送的消息由后端回显进事件流，使重连时仍能看到自己发出的消息。

**DeltaEvent**（流式增量）
```typescript
{ type: 'delta', text: string }
```
Assistant 回复的逐字追加片段，前端累加到当前消息的 `streaming` 字段。

**BlockEvent**（块级落定）
```typescript
{
  type: 'block',
  block:
    | { kind: 'text', text: string }
    | { kind: 'thinking', text: string }
    | { kind: 'tool_use', name: string, input: unknown, toolUseId: string }
}
```
一个完整内容块到达。`text` 块落定时前端应清空 `streaming`（它就是这块的最终文本）。

**ToolResultEvent**
```typescript
{ type: 'tool_result', toolUseId: string, text: string, isError: boolean }
```
工具执行结果。

**PromptEvent**（待答事项）
```typescript
{ type: 'prompt', prompt: PendingPrompt }

type PendingPrompt =
  | QuestionPrompt    // { kind: 'question', id, questions[] }
  | PermissionPrompt  // { kind: 'permission', id, toolName, title, detail }
  | PlanPrompt;       // { kind: 'plan', id, plan }
```
Claude 抛出需要用户决策的交互事项。前端渲染对应卡片，用户操作后 `POST /respond`。

**TurnEndEvent**
```typescript
{ type: 'turn_end', isError: boolean }
```
一轮对话结束（可继续输入）。

**StatusEvent**（状态机）
```typescript
{ type: 'status', state: 'idle' | 'executing' | 'waiting' }
```
明确表达当前状态：
- `idle`: 空闲，可发下一条消息
- `executing`: 执行中，正在处理
- `waiting`: 等待你回答待答项

**ClosedEvent**
```typescript
{ type: 'closed', reason: 'idle' | 'aborted' | 'exited' | 'detached' }
```
会话已终结。`detached` 表示优雅分离（不 abort，后台跑完）。

**RunInfoEvent**
```typescript
{ type: 'run_info', model?: string, effort?: string }
```
当前活跃 run 的模型信息。注意：`effort` 通常缺失（SDK 输出流不携带）。

### 与设计文档的对比

| 设计文档事件 | 实际实现 | 说明 |
|------------|---------|------|
| `assistant_delta` | `DeltaEvent` | 无 sessionId，字段名 `text` 而非 `content` |
| `assistant_message` | `BlockEvent` | 拆分为块级事件，不是完整 message |
| `tool_started` | ❌ 无对应事件 | 工具开始时不单独通知 |
| `tool_finished` | `ToolResultEvent` | 无 sessionId |
| `interaction_requested` | `PromptEvent` | 术语改为 prompt，无 sessionId |
| `interaction_resolved` | ❌ 无对应事件 | 前端自行管理已回答状态 |
| `session_error` | `ErrorEvent` | 无 sessionId |
| `session_done` | `ClosedEvent` | 增加 reason 字段区分终结原因 |
| ❌ 无 | `UserMessageEvent` | 新增：用户消息回显 |
| ❌ 无 | `TurnEndEvent` | 新增：轮次边界 |
| ❌ 无 | `StatusEvent` | 新增：状态机 |
| ❌ 无 | `RunInfoEvent` | 新增：模型元信息 |

## 11. 前端组件

> **实际实现**: 部分组件未按设计拆分，逻辑保留在 `Conversation.tsx` 内。

新增或拆分组件：

- ✅ `Composer.tsx`: 底部输入框、发送状态、附件上传（📎 按钮 + 预览）
- ❌ `InteractionCard`: 未创建，`Conversation.tsx` 内联判断 `prompt.kind` 并渲染对应卡片
- ✅ `QuestionCard.tsx`: 单选/多选问题卡片
- ✅ `PermissionCard.tsx`: 工具权限确认，显示工具名、参数摘要、允许/拒绝按钮，并可展示实时 diff 预览
- ✅ `PlanCard.tsx`: 计划审批卡片
- ✅ `Sidebar.tsx`: 已扩展为三段式结构：快捷新建、后台运行列表、项目/历史会话
- ⚠️ `DiffView.tsx`: 主要用于历史/工具详情的结构化 diff；权限卡片的实时 diff 当前采用更轻量的直渲染方案
- ❌ `ToolEvent`: 未单独拆分，工具事件在 `Conversation.tsx` 内渲染（折叠区块）

`Conversation.tsx` 目前仍然较大（~1000 行），包含消息流渲染、虚拟滚动、滚动逻辑、折叠区块、交互卡片内联判断等。

**实现建议**: 设计阶段建议的组件边界可作为后续重构方向，当前保持功能完整优先。

## 12. 安全与局域网访问

- 默认 `PERMISSION_MODE=default`。
- 所有 `/api` 和 SSE 继续要求 token。
- 普通 REST API 使用 `Authorization: Bearer <token>`。
- query token 仅保留给浏览器原生受限场景：`GET /api/events`、`GET /api/image`、`GET /api/sessions/:runId/stream`。
- 默认仅本机访问；如手机访问，需要显式绑定局域网地址。
- 不提供公网穿透。
- 不默认启用 `bypassPermissions`。
- 权限卡片必须显示关键参数；文件修改必须显示 diff 或说明无法生成 diff 的原因。

## 13. 错误处理与生命周期

> **实际实现**: 新增三种释放语义与 Hub 宽限期机制。

### 会话生命周期

活跃会话由 `SessionManager` 管理，支持三种释放方式：

1. **release()** — 前端明确放弃某个 run 或页面卸载时调用（`DELETE /sessions/:runId`）
   - 若会话**忙碌**（executing 或有待答项）→ 保留在池，后台继续跑
   - 若会话**空闲** → 立即 `detach()` 回收资源
   - 普通“切换查看别的会话”不再默认调用 release；切换只关闭当前 SSE 视图，不再隐式结束后台 agent

2. **detach()** — 优雅分离
   - 停止接收新输入，拒绝未决待答项
   - **不发送 abort 信号**，后台任务自然跑完
   - 发送 `closed:detached` 事件

3. **close()** — 强制关闭
   - 发送 abort 信号中止 SDK 执行
   - 拒绝所有未决 promise
   - 发送 `closed` 事件（reason: `idle` / `aborted` / `exited`）

4. **abortCurrentTurn()** — 停止当前轮次
   - 只中止当前 SDK 执行与当前轮 pending prompt
   - 发出 `turn_end(isError: true)` 与 `status: idle`
   - **不发送 `closed`**
   - 会话仍留在池中，可继续下一条输入

### Hub 宽限期

会话结束后，Hub 保留 **60 秒宽限期**（`HUB_GRACE_MS`）：
- 前端可在此期间重连并整段重放事件日志
- 无连接时，60 秒后自动清理 Hub
- 有连接时，宽限计时器由 SSE `onClose` 管理

### 错误处理

- **SDK runner 崩溃 / 模型连接失败**: SSE 推 `ErrorEvent`，同时补发 `turn_end(isError=true)` 与 `status: idle`，让前端退出“执行中”并显示错误；前端收到 `ErrorEvent` 本身也应立即清理 pending 并回到 `idle`，不能依赖后续第二个事件才反馈失败。后续用户可重新发送或关闭后台运行。
- **SSE 断线**: 前端实现指数退避重连（1s / 2s / 4s / 8s / 16s，最多 5 次），同一 `runId` 重连后整段重放 `hub.log` 恢复状态；并在首条重放事件到达前保留旧状态，避免闪烁。切换到不同 `runId` 时必须立即清空上一 run 的实时消息/待答/错误/模型/执行态，避免 A 的用户指令或流式输出串到 B。
- **恢复旧 run**: 前端在使用 `activeRuns` 恢复历史会话时先乐观挂接本地已知 `runId`，立即打开 SSE 并进入“连接中 / 接管中”；`GET /api/sessions/:runId` 只做异步探活。若后端明确返回 run 已失效，则清理脏映射并退回“接管/继续”；探活请求失败本身不应阻塞切换或打断接管
- **浏览器租约 heartbeat**: 前端每 15 秒对当前 `runId` 与本地 `activeRuns` 中的所有 run 去重发送 `POST /api/sessions/:runId/heartbeat`。后端用 `SESSION_HEARTBEAT_TTL_MS` 判断浏览器是否仍在接管；heartbeat 停止且 run 已 idle 后，再等待 `SESSION_ORPHAN_IDLE_TIMEOUT_MS` 回收，避免用户切走再切回时丢失已接管 run
- **后台运行补全接管**: 如果当前历史会话命中 `GET /api/sessions/active` 的后台 run，前端会自动挂接该 `runId` 并补写本地 `activeRuns`；侧栏“后台运行中”表示后端仍活着的 SDK run，不表示当前浏览器已经 SSE 连接。
- **接管状态表达**: 顶部状态栏用“已接管 / 连接中 / 后台运行中 / 未接管”区分浏览器 SSE 与后端 run；历史行的“后台运行”徽标只表示可接管。
- **停止语义**: `abortCurrentTurn()` 只停止当前 Claude 回合，发 `turn_end` 和 `status: idle`，不发 `closed`；前端应继续保持接管态和输入能力。
- **连接状态判定**: 前端不再依赖 `readyState` 的延迟探测补丁，而是仅以 `onopen` / `onmessage` 作为“已连接”信号
- **浏览 SSE 清理**: `ApiClient.disconnect()` 会主动关闭 `/api/events` 的浏览 SSE；`App.tsx` 在退出登录时显式调用，避免旧连接滞留
- **静态 token 失效处理**: `ApiClient` 的浏览类 REST 请求若收到 `401`，会触发上层未授权回调；`App.tsx` 随后清空本地 token / activeRuns、关闭浏览 SSE，并切回登录页
- **用户拒绝权限**: 卡片标记为已拒绝，`PendingRegistry.settle()` 返回拒绝结果，SDK 收到后继续或终止
- **pending interaction 超时**: 卡片可显示过期提示，后端 `session.close()` 时 `rejectAll()` 清理
- **空闲超时**（3 分钟无事件）: `SessionManager` 触发 `close(runId, "idle")`
- **并发超限**: `startNew` / `startContinue` 统一返回 `409` 友好错误；默认上限已收紧到 3 个后台运行

### 附件预览资源释放

- 用户消息中的文档附件点击后，会把 base64 内容转成 Blob 并在新窗口中预览
- 新窗口加载该 Blob URL 后，前端会立即 `URL.revokeObjectURL()` 回收临时 URL
- 这样文档附件具备与图片/上传预览一致的资源释放闭环，不会因反复点击而累积浏览器内存

## 14. 测试策略

仓库强制 TDD。实现时按以下测试推进：

- shared: 事件类型和 interaction/diff 类型编译契约。
- server: `ClaudeSessionManager` 使用 mock SDK，验证 resume、输入队列、事件转换。
- server: `InteractionManager` 验证 pending、resolve、拒绝、超时清理。
- server: `DiffBuilder` 已覆盖当前轻量实现；后续继续补 MultiEdit / 更复杂文件场景。
- routes: 新 API 的鉴权、参数校验、错误响应。
- web: `Conversation` 发送消息、接收流式事件、渲染 interaction。
- web: `useSession` 覆盖重连防闪烁、指数退避、`turn_end` 不追加空 assistant 气泡、连接状态判定。
- web: `PermissionCard` / `DiffView` 渲染 diff 预览与历史 diff，覆盖手机折叠与横向滚动场景。

## 15. 实现顺序

1. 扩展 shared 类型: realtime event、interaction、diff。
2. 后端新增 SDK 适配层和 mockable `ClaudeSessionManager`。
3. 打通历史 session resume + message + assistant 流式事件。
4. 前端新增 Composer，将流式回复追加到当前会话。
5. 接入权限确认卡片。
6. 接入 AskUserQuestion 和计划审批卡片。
7. 继续增强 DiffBuilder 与 DiffViewer 的复杂差异能力。
8. 手机端细节与端到端验证。
