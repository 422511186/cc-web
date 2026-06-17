# cc-web 设计文档

将本地 Claude Code 的聊天搬上 Web,支持浏览历史并在网页(含手机)里继续对话。

- 日期:2026-06-14（初版）
- 最后更新:2026-06-17（夜）
- 状态:✅ 已实现，文档已根据实际代码更新

## 1. 目标与范围

### 核心目标

既能**浏览**本地 Claude Code 的历史聊天,又能在**网页里继续对话**——包括在手机上回答 Claude Code 抛出的交互式问题(多选提问、权限确认、计划审批)。

### MVP 功能

- 浏览历史记录(项目 → session → 消息)
- 继续旧 session 续聊
- 新建对话
- 搜索历史
- 手机端回答 Claude 的交互式提问 / 权限确认 / 计划审批
- 流式逐字输出

### 非目标(本期不做)

- 多用户 / 账号体系(仅单一密码/令牌鉴权)
- 历史记录的编辑、导出（**删除已实现**: `DELETE /api/projects/:id/sessions/:sessionId`）
- 数据库持久化(直接读 `.jsonl`)
- 搜索索引(MVP 用内存全文扫描)
- **复杂 DiffBuilder 增强**（当前已实现 Edit / Write 工具的轻量 diff 预览；更复杂的 MultiEdit 合并与上下文增强留待后续迭代）

## 2. 整体架构

```
┌─────────────┐   HTTP + SSE   ┌────────────────────┐   Agent SDK   ┌──────────────┐
│  React 前端  │ ◄───────────► │  Node 后端 (Express)  │ ───────────► │  claude 子进程 │
│ (含手机端)   │                │                      │  stream-json  │   (本地常驻)   │
└─────────────┘                └──────────┬───────────┘               └──────────────┘
                                          │ 读
                                          ▼
                        ~/.claude/projects/**/*.jsonl
                              (历史聊天记录)
```

三层结构:

- **React 前端**:历史浏览、对话视图、续聊/新建输入框、流式渲染、手机端交互卡片(单选/多选/允许-拒绝/批准计划)。
- **Node 后端 (Express)**:① 读取并解析 `.jsonl` 历史(浏览 + 搜索);② 通过官方 Agent SDK 启动并管理 claude 常驻会话;③ 把流式输出与待答事项经 SSE 转发给前端;④ 鉴权中间件前置于所有路由。
- **claude 子进程**:由 Agent SDK 管理,真正执行对话与工具调用。

### 前后端通信

- **回复流 / 待答事项**:SSE(Server-Sent Events)。单向"后端→前端",HTTP 原生、自动重连。
- **发消息 / 提交答案**:普通 POST。

## 3. 后端 ↔ Claude Code 集成

使用官方 **Agent SDK**(`@anthropic-ai/claude-agent-sdk`)的 `query()` 函数,封装了 spawn 子进程、解析 stream-json、双向通信。

```js
import { query } from "@anthropic-ai/claude-agent-sdk";

const session = query({
  prompt: asyncIterableOfUserMessages,   // 流式输入:把手机端回答喂回去
  options: {
    resume: sessionId,                    // 续聊旧 session
    permissionMode: config.permissionMode, // 可配置,默认 "default"
    canUseTool: async (tool, input) => {  // 权限确认回调
      return await waitForUserDecision(tool, input); // 挂起,等手机端决策
    },
  },
});

for await (const msg of session) {        // 流式输出:逐字 / 逐事件
  pushToBrowserViaSSE(msg);
}
```

### 交互事件映射

| Claude 抛出的事件 | SDK 表现 | 手机网页渲染 | 用户回答后 |
|---|---|---|---|
| 普通回复 | `assistant` 消息流 | 逐字气泡 | — |
| 要执行命令 / 改文件 | `canUseTool` 回调 | 「允许 / 拒绝」按钮卡片 | resolve 回调 |
| 多选提问 (AskUserQuestion) | 工具调用事件 | A/B/C/D 单/多选卡片 | 答案 → 流式输入 |
| 计划审批 (ExitPlanMode) | 工具调用事件 | 「批准计划」卡片 | 答案 → 流式输入 |

### 交互模型:挂起—推送—等待—恢复

后端 `query()` 循环遇到需要决策的事件时**挂起**(回调里 `await` 一个 Promise),同时通过 SSE 把结构化"待答事项"推到手机;用户在网页点选,前端 POST 回答案,后端 resolve 该 Promise,会话继续。

```
用户在手机点「允许」
      │ POST /api/sessions/:id/respond
      ▼
  Node 后端 ──写回调/stdin──► claude 子进程(常驻)
      ▲                              │
      │ SSE 推「有个待答事项」          │ 输出:提问 / 权限 / 计划事件
      └──────────────────────────────┘
```

## 4. 数据层

后端不使用数据库,直接读 `~/.claude/projects/**/*.jsonl`。

- 每个目录 = 一个项目(目录名是编码过的路径,如 `C--Users-huang-Desktop`)。
- 每个 `.jsonl` 文件 = 一个 session,逐行 JSON 记录。

### JSONL 解析器模块

- 逐行读取,过滤出可展示的消息类型(`user` / `assistant` / `text`),跳过噪音类型(`system` / `mode` / `permission-mode` / `file-history-snapshot` / `last-prompt` 等)。
- 组装统一消息结构:角色、内容、时间戳、模型。
- 容错:跳过损坏行、处理空文件。

### 会话标题

JSONL 无现成标题。用该 session 第一条 `user` 消息的前若干字符作为标题。

### 搜索

MVP:内存全文扫描,关键字匹配消息内容。数据量大后再考虑建索引(非目标)。

## 5. API 设计

> **注**: 实际实现中，运行时路由使用 `runId`（活跃会话运行时标识），续聊时 `runId = sessionId`，新建时 `runId` 为随机 UUID。

所有 `/api` 路由前置鉴权中间件。

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/projects` | 列出所有项目 |
| `GET` | `/api/projects/:id/sessions` | 列出某项目下的 session(标题、时间、消息数) |
| `GET` | `/api/sessions/:id` | 读取某 session 完整消息(需带 `?projectId=`) |
| `GET` | `/api/search?q=` | 全文搜索历史 |
| `DELETE` | `/api/projects/:projectId/sessions/:sessionId` | 删除历史会话（已实现） |
| `POST` | `/api/sessions/new` | 新建对话，返回 `{runId}` |
| `POST` | `/api/sessions/:sessionId/continue` | 续聊（runId 复用 sessionId），需带 `projectId` 定位原工作目录 |
| `GET` | `/api/sessions/:runId` | 探测某活跃 run 是否仍在后端池中（前端恢复旧连接前先判活） |
| `GET` | `/api/sessions/:runId/stream` | SSE:流式接收回复 + 待答事项（**重连整段重放全量事件日志**） |
| `POST` | `/api/sessions/:runId/message` | 发送用户消息（`text` + 可选 `attachments`） |
| `POST` | `/api/sessions/:runId/respond` | 提交答案（权限 / 选项 / 计划），`interactionId` 在请求体中 |
| `POST` | `/api/sessions/:runId/abort` | 停止当前轮次执行，但保留会话以便后续继续输入 |
| `DELETE` | `/api/sessions/:runId` | 释放会话（忙碌保活 / 空闲回收） |
| `POST` | `/api/uploads` | 上传附件，返回 `{ref, filename}` |
| `GET` | `/api/image?path=` | 读取粘贴图片（限 `CLAUDE_IMAGE_CACHE_DIR` 下） |

鉴权边界：

- 普通 REST API 使用 `Authorization: Bearer <token>`。
- query token 仅保留给浏览器原生受限场景：`GET /api/events`、`GET /api/image`、`GET /api/sessions/:runId/stream`。
- 当前没有单独的 `/api/auth` 登录换票接口；前端登录本质上是保存用户输入的静态 token。
- 若浏览类 API 返回 `401 Unauthorized`，前端会自动清理本地 `sessionStorage` 中的 `authToken` / `cc-web-activeRuns`，断开浏览 SSE，并退回登录页；这表示“本地保存的静态 token 已失效或与服务端配置不匹配”。

## 6. 前端 UI 设计

UI 原型已在浏览器中确认。原型文件存于 `.superpowers/brainstorm/`(未纳入 git)。

### 桌面端布局

```
┌──────────────────────────────────────────────────────────┐
│  对话标题                                      ● 已连接      │  顶栏
├────────────┬─┬───────────────────────────────────────────┤
│ [搜索框]    ║ │  ┌─ user 气泡 ───────────────────┐         │
│ [+ 新建对话] ║ │  └────────────────────────────────┘         │
│            ║ │         ┌─ assistant 气泡(流式)─┐          │
│ ▾ 项目 A    ║ │         └──────────────────────────┘          │
│   · session ║ │  ▸ 💭 思考中…(折叠)                         │  主区
│   · session ║ │  ▸ Bash: npm test ✓(折叠)                   │
│ ▾ 项目 B    ║ │                                              │
│   · session ║ │  ┌──────────────────────────────────────┐  │
│            ║ │  │ 📎 🖼️  [输入消息…]            [发送]  │  │  输入区
└────────────┴─┴──┴──────────────────────────────────────┴──┘
   侧栏      拖拽手柄          (附件预览区在输入框上方)
```

- **可拖拽侧栏**:侧栏与主区之间有拖拽手柄,可调宽度。
- **可折叠侧栏**:顶部「«」按钮收起整个侧栏(主区全宽),收起后留「»」按钮可展开。
- **侧栏内容**:搜索框 + 「新建对话」按钮 + 按项目分组的 session 列表(标题 + 时间)。
- **附件 / 图片上传**:输入区左侧 📎(附件)、🖼️(图片)按钮,已选文件在输入框上方显示缩略图预览。

### 手机端布局

- **抽屉式侧栏**:桌面侧栏在手机上变为汉堡菜单(☰)触发、从左滑出的抽屉,带遮罩。
- **主界面**:顶栏(☰ + 标题 + 连接状态)、消息流、底部输入框(含 📎🖼️ 上传)。
- 这是项目最核心的使用场景。

### 交互卡片(双端一致)

Claude 抛出交互事件时,在对话流中渲染为卡片:

- **答题卡片**:题目 + A/B/C/D 大按钮(单选 / 多选)+「提交」。手机上即可点选,体验等同 CLI 的 AskUserQuestion。
- **权限确认卡片**:工具名 + 要执行的命令 / 改动内容 +「✓ 允许」「✗ 拒绝」大按钮。
- **计划审批卡片**:计划内容 +「批准 / 拒绝」。

### 可折叠区块(双端共用组件)

`thinking` 与 `tool` 输出**默认折叠**,只显示摘要条,避免长内容刷屏:

- **thinking**:折叠态显示「💭 思考中…」或思考首行 + ▸ 箭头;展开显示完整思考。
- **tool 调用**:折叠态显示工具名 + 关键参数(如 `Bash: npm test`、`Read: config.js`)+ 状态图标(运行中 / ✓ 成功 / ✗ 失败);展开显示完整命令 / 参数与输出。

## 7. 配置

启动时通过环境变量 / 配置文件指定。关键项:

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `AUTH_TOKEN` | (必填) | 单一访问密码 / 令牌；缺失则启动失败 |
| `PERMISSION_MODE` | `"default"` | 权限模式,可选 `default` / `acceptEdits` / `bypassPermissions` 等。**非 default 为高风险,远程慎用** |
| `PORT` | `3000`（dev 用 3002） | 服务端口 |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | 历史记录根目录 |
| `CLAUDE_IMAGE_CACHE_DIR` | `<projects 同级>/image-cache` | 粘贴图片缓存目录 |
| `SESSION_IDLE_TIMEOUT_MS` | `180000`（3 分钟） | 活跃会话空闲超时（毫秒）；执行中/有产出则续期 |
| `MAX_CONCURRENT_SESSIONS` | `4` | 同时运行的会话数上限；超限则新建会抛错 |
| `UPLOADS_DIR` | `<cwd>/uploads` | 附件上传保存目录 |

## 8. 生命周期管理与错误处理

### 会话生命周期

活跃会话由 `SessionManager` 管理，有三种释放语义：

1. **release()**：前端切走/关页面时调用（`DELETE /sessions/:runId`）
   - 若会话**忙碌**（executing 或有待答项）→ 保留在池，后台继续跑，等待重连
   - 若会话**空闲** → 立即 `detach()` 回收资源
   - 但前端**普通切换会话**不再默认调用该接口；切换只是切视图，不应隐式放弃当前 run
   
2. **detach()**：优雅分离
   - 停止接收新输入，拒绝未决待答项
   - **不发送 abort 信号**，后台任务自然跑完
   - 发送 `closed:detached` 事件
   
3. **close()**：强制关闭
   - 发送 abort 信号中止 SDK 执行
   - 拒绝所有未决 promise
   - 发送 `closed` 事件（reason: `idle` / `aborted` / `exited`）

补充：`POST /api/sessions/:runId/abort` 现在走的是“停止当前轮次”语义，而不是 `close()` 语义。它会尽快中止当前执行，并把状态切回 `idle`，但**不会**发送 `closed`，也不会把会话从活跃池中移除。

### Hub 与事件重放

每个 `runId` 维护一个 **Hub**（事件中枢）：

- `log: ServerEvent[]`：全量事件日志，支持前端切走再切回时**整段重放**
- `channel: SSEChannel`：当前 SSE 连接，实时推送新事件
- `graceTimer`：会话结束后保留 **60 秒宽限期**，供重连使用
- **`resetHub(sessionId)`**：续聊前清掉旧 Hub，避免重放出旧的 `closed` 事件（续聊复用 sessionId 作 runId 的碰撞防护）

### 错误处理

- **子进程崩溃/退出**：SSE 推 `error` 事件，前端显示「会话中断」，可重试
- **空闲超时**（3 分钟无事件产出）：自动回收会话，释放资源
- **并发上限**：限制同时运行的会话数（`MAX_CONCURRENT_SESSIONS`），防止资源耗尽
- **前端**：续聊 SSE 断线自动重连，重连后整段重放事件日志恢复状态；网络/发送失败给明确提示
- **恢复旧 run**：前端恢复持久化 `activeRuns` 时，会先调用 `GET /api/sessions/:runId` 做快速探活；若 run 已失效，则立即清理本地记录并回到“在此继续”，避免卡在慢重连里
- **浏览 SSE**：`ApiClient` 显式持有 `/api/events` 连接，并在退出登录时通过 `disconnect()` 主动关闭，避免旧连接滞留
- **静态 token 失效**：浏览态请求若收到 `401`，前端会自动清理本地登录态并退回登录页，避免界面停留在“已登录但所有请求都失败”的假状态

## 9. 安全

远程访问是高风险点(别的设备可连到能执行命令/改文件的 Claude 服务),重点防护:

- **鉴权**:所有 `/api` 与 SSE 路由前置鉴权中间件;令牌从环境变量/配置读,不硬编码。
- **传输**:远程访问建议套 HTTPS(自签证书或反向代理),否则密码明文过网。
- **权限策略**:默认 `permissionMode: "default"`(危险操作仍需手机确认);可经配置调整,文档明确标注高风险选项警告。
- **路径隔离**:解析历史时校验路径,只读 `CLAUDE_PROJECTS_DIR` 下文件,防目录穿越。

## 10. 测试策略

- **单元测试 (Vitest)**:JSONL 解析器(各种消息类型、损坏行、空文件)、搜索匹配、会话标题提取。
- **集成测试**:API 路由(鉴权拦截、列表/读取/搜索),用 mock 文件系统数据。
- **SDK 交互**:把 `query()` 包一层适配器,测试时 mock 该适配器,验证「挂起—推送—恢复」事件流转,不真调 claude。
- **手动验证**:真机(手机浏览器)端到端跑一次续聊 + 答题 + 权限确认。

## 11. 项目结构(Monorepo)

用 **npm workspaces** 组织 monorepo。核心动机:前后端共享 TypeScript 类型(SSE 事件、API 契约、交互卡片数据结构),避免前后端定义漂移。

```
cc-web/
├── package.json            # 根:workspaces 声明 + 公共脚本
├── tsconfig.base.json      # 共享 TS 配置
├── packages/
│   ├── shared/             # @cc-web/shared:共享类型与契约
│   │   ├── src/
│   │   │   ├── events.ts   # SSE 事件类型（ServerEvent, PendingPrompt, PromptAnswer）
│   │   │   ├── api.ts      # REST 请求/响应类型
│   │   │   └── types.ts    # 领域模型（Project, Session, Message）
│   │   └── package.json
│   ├── server/             # @cc-web/server:Node + Express 后端
│   │   ├── src/
│   │   │   ├── index.ts        # 入口 + 配置加载
│   │   │   ├── app.ts          # Express 装配
│   │   │   ├── auth.ts         # 鉴权中间件
│   │   │   ├── config.ts       # 环境变量加载
│   │   │   ├── store.ts        # JSONL 历史读取（SessionStore）
│   │   │   ├── jsonl.ts        # JSONL 解析器
│   │   │   ├── title.ts        # 标题提取
│   │   │   ├── search.ts       # 全文搜索
│   │   │   ├── sse.ts          # 浏览用 SSE（文件变更推送）
│   │   │   ├── watcher.ts      # 文件变更监听
│   │   │   ├── routes.ts       # 浏览 REST + SSE 路由
│   │   │   ├── sessionManager.ts  # 活跃会话池（并发上限 + 空闲超时）
│   │   │   ├── session.ts      # 单个会话状态机（detach/close 区分）
│   │   │   ├── sdk.ts          # Agent SDK 适配层
│   │   │   ├── inputQueue.ts   # 异步输入队列（AsyncIterable）
│   │   │   ├── pending.ts      # 待答项注册表（PendingRegistry）
│   │   │   ├── chatRoutes.ts   # 续聊 REST + 流式 SSE（Hub 事件中枢）
│   │   │   ├── sseChannel.ts   # SSE 连接封装
│   │   │   └── uploads.ts      # 附件上传
│   │   └── package.json    # 依赖 @cc-web/shared
│   └── web/                # @cc-web/web:React 前端
│       ├── src/
│       │   ├── App.tsx             # 根组件（登录 + 会话选择 + URL 状态）
│       │   ├── api.ts              # 浏览 API 客户端
│       │   ├── chatApi.ts          # 续聊 REST 封装
│       │   ├── useSession.ts       # SSE 流式状态管理 hook
│       │   ├── diff.ts             # 文本 diff 计算
│       │   └── components/
│       │       ├── Login.tsx
│       │       ├── Sidebar.tsx
│       │       ├── MobileMenu.tsx
│       │       ├── Conversation.tsx    # 消息流渲染
│       │       ├── Composer.tsx        # 输入框 + 附件上传
│       │       ├── QuestionCard.tsx    # 答题卡片（单选/多选）
│       │       ├── PermissionCard.tsx  # 权限确认卡片
│       │       ├── PlanCard.tsx        # 计划审批卡片
│       │       ├── DiffView.tsx        # 历史 diff 展示
│       │       ├── AttachmentPreview.tsx
│       │       ├── ConfirmDialog.tsx
│       │       └── AlertDialog.tsx
│       └── package.json    # 依赖 @cc-web/shared
```

> **实现演进**: 设计阶段简化为 `sessions.ts` 单文件，实际实现将会话管理拆分为 `SessionManager` / `Session` / `InputQueue` / `PendingRegistry` / `chatRoutes` 等模块以提升可维护性。

根 `package.json` 提供公共脚本(`npm run dev`、`npm run build`、`npm test`),通过 workspaces 分发到各包。

## 12. 技术栈

- 语言:**TypeScript**(全栈,monorepo 共享类型)
- 后端:Node + Express + `@anthropic-ai/claude-agent-sdk`
- 前端:React(Vite)
- 测试:Vitest
- 通信:HTTP(REST)+ SSE
- Monorepo:npm workspaces
