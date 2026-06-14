# cc-web 实时续聊与确认交互设计

- 日期: 2026-06-14
- 状态: 已根据原型反馈确认
- 原型: `.superpowers/brainstorm/4760-1781450740/content/cc-web-prototype.html`

## 1. 目标

把本地 Claude Code 的历史会话继续提问能力搬到 Web 端。用户在浏览历史 session 时，可以直接在同一页面继续输入；Claude 的回复、权限确认、AskUserQuestion、计划审批和文件 diff 都以结构化 Web UI 展示。

本期只面向本机 / 局域网手机访问，不做公网服务、多用户账号、云同步或远程穿透。

## 2. 已确认的产品决策

- 历史浏览和实时续聊使用同一个 Conversation 页面。
- 打开历史 session 后，底部输入框直接可用；第一次发送时后端自动 resume 原 Claude Code session。
- 使用 Claude Code Agent SDK 接入实时会话，不用 PTY 复刻 CLI 终端。
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

```text
React Web
  | REST: 发消息 / 提交交互结果
  | SSE: 回复流 / 工具事件 / 待确认卡片 / diff
  v
Node Express
  - SessionStore: 历史 JSONL 读取
  - ClaudeSessionManager: Agent SDK 会话运行
  - InteractionManager: 权限和 Ask 挂起/恢复
  - DiffBuilder: 生成结构化 diff
  v
Claude Code Agent SDK
  v
本地 Claude Code 进程
```

后端继续直接读取历史 JSONL。实时续聊时，后端用 Agent SDK `query()` resume 原 session，并把前端输入通过 async iterable 送入 SDK。

## 5. 历史会话继续提问

用户打开历史 session 后看到完整历史消息。底部输入框始终显示。

发送第一条新消息时：

1. 前端调用 `POST /api/sessions/:sessionId/message`，附带 `projectId` 和用户输入。
2. 后端发现该 session 没有运行中的 runner，自动创建 runner。
3. runner 使用 Agent SDK resume 原 `sessionId`，并设置原项目工作目录。
4. 用户消息写入 runner 输入队列。
5. SDK 输出通过 SSE 推回当前 Conversation。

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

MVP 采用 unified diff，不做 split diff。

支持来源：

- `Edit`: 从 `old_string` / `new_string` 生成局部 diff。
- `MultiEdit`: 每个 edit 生成 hunk，按文件合并展示。
- `Write`: 若能读取旧文件，则展示旧内容到新内容的 diff；若是新文件，展示新增文件 diff。

暂不解析普通 `Bash` 输出中的 diff；`Bash` 仍按工具日志展示。

前端组件：

- `DiffViewer`: 接收文件 diff 列表，按文件展示 additions/deletions。
- 桌面端默认可展开完整 hunks。
- 手机端默认折叠文件，展开后代码区允许横向滚动。
- 大 diff 需要限制首屏高度，提供“展开更多”。

## 8. 后端模块

### ClaudeSessionManager

职责：

- 管理运行中的 Claude runner。
- 按 `sessionId` resume 历史会话。
- 创建新会话。
- 维护用户输入 async queue。
- 将 SDK 输出转换成 Web SSE 事件。
- 处理 runner 崩溃、结束、空闲超时。

### InteractionManager

职责：

- 管理 pending interactions。
- 为权限确认、AskUserQuestion、计划审批生成 `interactionId`。
- SSE 推送 interaction 卡片。
- 接收前端 respond 请求后 resolve 对应 Promise。
- 超时或 session 结束时清理 pending 状态。

### DiffBuilder

职责：

- 从 Agent SDK 工具 input/result 生成结构化 diff。
- 隔离文件读取逻辑，避免前端理解工具 JSON。
- 控制 diff 大小，避免超大文件拖垮前端。

## 9. API

保留现有 API：

```text
GET /api/projects
GET /api/projects/:projectId/sessions
GET /api/sessions/:sessionId?projectId=
GET /api/search?q=
GET /api/events
GET /api/image?path=
```

新增 API：

```text
POST /api/sessions/new
POST /api/sessions/:sessionId/continue
POST /api/sessions/:sessionId/message
POST /api/sessions/:sessionId/interactions/:interactionId/respond
GET  /api/sessions/:sessionId/stream
```

说明：

- MVP 可以先复用现有 `/api/events`，通过 typed event 区分 session。
- 后续如需要减少无关推送，再引入 per-session `/stream`。

## 10. SSE 事件类型

事件需要在 shared 包中定义，避免前后端契约漂移。

```ts
type RealtimeEvent =
  | { type: 'assistant_delta'; sessionId: string; content: string }
  | { type: 'assistant_message'; sessionId: string; message: Message }
  | { type: 'tool_started'; sessionId: string; toolCall: ToolCallSummary }
  | { type: 'tool_finished'; sessionId: string; toolCallId: string; result: ToolResultSummary }
  | { type: 'interaction_requested'; sessionId: string; interaction: InteractionCard }
  | { type: 'interaction_resolved'; sessionId: string; interactionId: string; result: InteractionResult }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'session_done'; sessionId: string };
```

## 11. 前端组件

新增或拆分组件：

- `Composer`: 底部输入框、发送状态、附件入口。
- `InteractionCard`: 根据 interaction kind 渲染权限、Ask、计划审批。
- `PermissionCard`: 工具权限确认，内含 diff 摘要和按钮。
- `AskUserQuestionCard`: 单选/多选问题。
- `PlanApprovalCard`: 计划审批。
- `DiffViewer`: unified diff。
- `ToolEvent`: 折叠工具事件。

`Conversation.tsx` 目前偏大。实现时可以先做小范围增量修改，随后按上述边界拆分。

## 12. 安全与局域网访问

- 默认 `PERMISSION_MODE=default`。
- 所有 `/api` 和 SSE 继续要求 token。
- 默认仅本机访问；如手机访问，需要显式绑定局域网地址。
- 不提供公网穿透。
- 不默认启用 `bypassPermissions`。
- 权限卡片必须显示关键参数；文件修改必须显示 diff 或说明无法生成 diff 的原因。

## 13. 错误处理

- SDK runner 崩溃: SSE 推 `session_error`，前端显示可重试状态。
- SSE 断线: 前端自动重连并重新拉取 session。
- 用户拒绝权限: 卡片标记为已拒绝，runner 收到拒绝结果继续或终止。
- pending interaction 超时: 卡片显示过期，后端清理 Promise。
- diff 生成失败: 权限卡片仍显示工具参数，并提示无法生成 diff。

## 14. 测试策略

仓库强制 TDD。实现时按以下测试推进：

- shared: 事件类型和 interaction/diff 类型编译契约。
- server: `ClaudeSessionManager` 使用 mock SDK，验证 resume、输入队列、事件转换。
- server: `InteractionManager` 验证 pending、resolve、拒绝、超时清理。
- server: `DiffBuilder` 覆盖 Edit、MultiEdit、Write、新文件、失败场景。
- routes: 新 API 的鉴权、参数校验、错误响应。
- web: `Conversation` 发送消息、接收流式事件、渲染 interaction。
- web: `DiffViewer` 渲染 additions/deletions、手机折叠状态。

## 15. 实现顺序

1. 扩展 shared 类型: realtime event、interaction、diff。
2. 后端新增 SDK 适配层和 mockable `ClaudeSessionManager`。
3. 打通历史 session resume + message + assistant 流式事件。
4. 前端新增 Composer，将流式回复追加到当前会话。
5. 接入权限确认卡片。
6. 接入 AskUserQuestion 和计划审批卡片。
7. 接入 DiffBuilder 与 DiffViewer。
8. 手机端细节与端到端验证。
