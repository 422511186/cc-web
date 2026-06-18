# cc-web 设计演进记录

> 本文档记录设计文档与实际实现之间的关键差异、架构演进与仍待完成的功能。
> 
> 最后更新：2026-06-18

---

## 📋 概述

cc-web 项目在实现过程中，架构设计经历了多处演进与调整。本文档澄清设计意图与实际实现的差异，避免后续维护者因文档滞后而产生困惑。

---

## 🔄 关键架构演进

### 1. runId vs sessionId 的语义分离

**设计意图**: 文档中混用 `sessionId` 作为历史会话标识与运行时标识。

**实际实现**: 引入明确的语义区分：
- **`sessionId`**: 历史会话唯一标识（JSONL 文件名），用于浏览历史、续聊入口
- **`runId`**: 运行时活跃会话标识，用于 SSE 流、发送消息、提交答案
  - 新建会话：`runId` 为随机 UUID
  - 续聊会话：**`runId` 复用原 `sessionId`**（关键设计决策）

**动机**: 
1. URL 简洁性：续聊时无需生成新 ID，直接用原 sessionId
2. 重连语义清晰：同一 `runId` 下的 SSE 重连会重放完整事件日志

**代价**: 同一 `sessionId` 上新旧会话可能碰撞，需两处防护：
1. `chatRoutes.resetHub(sessionId)` — 清掉上一轮残留 Hub（含旧 `closed` 事件）
2. `sessionManager.finally` 实例相等校验 — 避免误杀重建的新会话

**API 路径体现**:
```
POST /api/sessions/:sessionId/continue  → 返回 {runId: sessionId}
POST /api/sessions/:runId/message       → 用 runId 操作
GET  /api/sessions/:runId/stream        → 用 runId 订阅
```

---

### 2. Hub 事件中枢与整段重放机制

**设计文档**: 未提及"事件日志"、"重放"、"宽限期"。

**实际实现**: 每个 `runId` 维护一个 **Hub**（`chatRoutes.ts`）：

```typescript
interface Hub {
  log: ServerEvent[];        // 全量事件日志，永不清空（直到宽限期到期）
  channel: SSEChannel | null; // 当前 SSE 连接
  closed: boolean;           // 是否已收到 closed 事件
  graceTimer: NodeJS.Timeout | null; // 60 秒宽限清理计时器
}
```

**核心机制**:
1. **append-only 日志**: 所有 `ServerEvent` 追加到 `hub.log`，支持前端切走再切回时**整段重放**
2. **60 秒宽限期**: 会话结束后保留 Hub 60 秒（`HUB_GRACE_MS`），供前端重连使用
3. **双通道推送**: 实时有连接时推送 `channel.send(event)`，重连时重放 `log` 数组

**用户价值**: 前端可随时切走（如切换会话、刷新页面），切回时完整恢复状态，无需后端维护"错过的消息"队列。

**技术债务**: 此问题已修复。`Hub.log` 现已做上限截断（见 `docs/TECH-DEBT.md` P1-1）。

---

### 3. release() 忙碌保活机制

**设计文档**: 仅提及"空闲超时自动回收"。

**实际实现**: 引入 `release()` 语义（`sessionManager.ts`），区分忙碌与空闲：

```typescript
release(runId: string): void {
  const entry = this.entries.get(runId);
  if (!entry) return;
  if (entry.session.isBusy()) return; // 忙碌：保活，等重连或空闲超时
  this.detach(runId);                 // 空闲：立即回收
}
```

**三种释放语义**:
1. **release()**: 前端切走/关页面时调用（`DELETE /sessions/:runId`）
   - 后端语义仍是：忙碌 → 保留在池，空闲 → detach 回收
   - 但前端**普通切换会话**已不再默认调用 release；切换只是切视图，不再隐式释放当前 run
2. **detach()**: 优雅分离，不 abort，让后台任务自然结束
3. **close()**: 强制中止，发送 abort 信号

**用户价值**: 切换会话时，正在执行的任务（如长时间编译）不会被中断；即使会话已空闲，只要 run 仍活着，切回时也能直接接管，不再平白丢连接。

---

### 4. SSE 事件类型的细化拆分

**设计文档** (`2026-06-14-cc-web-realtime-conversation-design.md` 第 170-179 行):
```typescript
type RealtimeEvent =
  | { type: 'assistant_delta'; sessionId: string; content: string }
  | { type: 'assistant_message'; sessionId: string; message: Message }
  | { type: 'tool_started'; ... }
  | { type: 'interaction_requested'; ... }
  ...
```

**实际实现** (`shared/src/events.ts`):
```typescript
export type ServerEvent =
  | UserMessageEvent        // 用户消息回显（重连后仍可见）
  | DeltaEvent              // 流式增量（逐字追加）
  | BlockEvent              // 完整块（text/thinking/tool_use 落定）
  | ToolResultEvent         // 工具执行结果
  | PromptEvent             // 待答事项（question/permission/plan）
  | TurnEndEvent            // 一轮对话结束
  | ErrorEvent              // 会话错误
  | ClosedEvent             // 会话终结（idle/aborted/exited/detached）
  | StatusEvent             // 状态机（idle/executing/waiting）
  | RunInfoEvent;           // 模型与推理强度信息
```

**关键差异**:
1. **无 `sessionId` 字段**: 通过 SSE URL (`/sessions/:runId/stream`) 隐式绑定
2. **更细粒度**: 拆分 `DeltaEvent`（流式）/ `BlockEvent`（落定）/ `TurnEndEvent`（轮次）
3. **新增状态机**: `StatusEvent` 明确表达"空闲可发 / 执行中 / 等待你回答"
4. **用户消息回显**: `UserMessageEvent` 让重连后仍能看到用户发出的消息

**动机**: 前端需要明确的状态转换信号（而非推断），以及流式输出的逐字追加与块级落定的区分。

---

## ⚠️ 未完全按原设计实现的功能

### 1. DiffBuilder 与实时 diff 生成

**设计文档**: `2026-06-14-cc-web-realtime-conversation-design.md` 第 87-105 行详细设计了 DiffBuilder 模块，从 Edit/MultiEdit/Write 工具生成 unified diff。

**实际状态** (2026-06-17 更新): 
- ✅ **已实现**: `diffBuilder.ts` 从 Edit / Write 工具参数生成 unified diff
- ✅ **集成**: `session.ts` 在权限确认时调用 `buildDiff()` 并附加到 `PermissionPrompt.diff`
- ✅ **前端展示**: `PermissionCard.tsx` 渲染 diff 预览，按 `+ / - / @@` 做行级着色
- ⚠️ **当前边界**: 仍是偏轻量实现，未完全覆盖设计文档里更复杂的差异合并策略

**影响**: 用户在权限确认前现在可以预览具体代码改动，显著提升安全性。

---

### 2. InteractionCard 统一组件

**设计文档**: 建议创建 `InteractionCard` 组件，根据 `kind` 渲染不同卡片。

**实际状态**: 
- **未实现**: 三个卡片组件独立存在（`QuestionCard.tsx` / `PermissionCard.tsx` / `PlanCard.tsx`）
- **现状**: `Conversation.tsx` 内联判断 `prompt.kind` 并渲染对应卡片

**影响**: 代码略显冗余，但功能完整。

---

### 3. 虚拟滚动优化

**设计文档**: `TECH-DEBT.md` P2-F4 提出长对话（1000+ 条消息）性能优化需求。

**实际状态** (2026-06-17):
- ✅ **已实现**: `Conversation.tsx` 已接入 `react-window` v2 的 `List`
- ✅ **动态高度**: 使用 `useDynamicRowHeight({ defaultRowHeight: 140, key: sessionId })`
- ✅ **滚动导航**: 旧 `messageRefs` 已移除，统一通过 `useListRef()` + `scrollToRow()` 完成定位
- ✅ **统一数据行**: 历史消息、实时消息、pending 卡片统一收敛为 `ConversationRow[]`
- ✅ **测试覆盖**: 已有长列表测试验证 200 条消息不会全部挂入 DOM

**影响**: 长对话场景下，历史消息不再一次性渲染全部节点，滚动与切换性能明显改善。

---

### 4. 重连重建时机优化

**设计文档**: 只强调了 SSE 自动重连与事件重放，没有明确前端“何时清空旧状态”的策略。

**实际状态** (2026-06-17):
- ✅ **已实现**: `useSession.ts` 不再在 `EventSource.onopen` 里立即清空 `messages/pending/status`
- ✅ **当前策略**: onopen 只标记 `rebuildingRef.current = true`，等首条重放事件到达时再原子清空并重建

**动机**:
1. 避免 `onopen` 与首条重放事件之间出现界面瞬间空白
2. 保持“旧状态持续可见，直到新重放真正开始”的用户体验

**影响**: 断线重连时，前端不再发生明显闪烁，体验更接近用户对聊天应用的直觉。

---

### 5. activeRuns 从“记录”升级为“恢复协议”

**设计文档**: 只强调 Hub 整段重放与前端重连，没有明确 `activeRuns` 在刷新/切换会话时的精确定义。

**实际实现** (2026-06-17 夜):
- ✅ `activeRuns` 不再只是“记住用户点过继续的 session”，而是明确表示“当前仍可接管的活跃 run”
- ✅ 刷新页面时，如 URL 中的 `sessionId` 命中 `activeRuns`，前端直接恢复对应 `runId` 的 SSE 接管，不再重复 `startContinue`
- ✅ 恢复前会先调用 `GET /api/sessions/:runId` 做快速探活；若 run 已失效，则立即清理脏映射并回到“接管/继续”
- ✅ 切走再切回同一历史会话时：
  - 忙碌 run（`executing` / `waiting`）→ 自动接管
  - 空闲但仍活着的 run（`idle`）→ 也自动接管
  - 只有 run 实际已结束 / 已失效时，才清理 `activeRuns` 并重新显示“接管/继续”
- ✅ 收到 `closed` 事件后同步删除对应 `activeRuns` 持久化记录，避免保留脏 runId

**动机**:
1. 区分“后端释放语义”和“前端视图切换语义”：切视图不等于放弃接管
2. 避免把“恢复现有 run”与“重新创建 continue run”混为一谈
3. 避免残留死 run 导致切回时先傻等 SSE 重试，造成“连接丢失且恢复很慢”的体感

**影响**: 用户在忙碌或空闲状态下切会话、刷新、再回来，都会更稳定地接管同一个活跃会话；只有 run 真死了时才退回继续按钮。

---

### 6. “停止”从关闭会话改为只停止当前轮次

**设计文档**: 早期 `POST /api/sessions/:runId/abort` 被默认理解成“终止整个活跃会话”。

**实际实现** (2026-06-17 夜):
- ✅ `SessionManager.abort()` 不再移除会话，也不再触发 `close(runId, "aborted")`
- ✅ `Session.abortCurrentTurn()` 只会：
  - abort 当前 SDK 执行
  - reject 当前轮的 pending prompt
  - 发出 `turn_end(isError: true)` 与 `status: idle`
  - **不会**发 `closed`
- ✅ `Session` 会学习 SDK 返回的真实 `session_id`，这样“停止当前轮次后再发下一条”仍能续在同一个 Claude 会话上下文里

**动机**:
1. 用户点击“停止”通常是在说“停掉这次执行”，不是“断开这个会话”
2. 若 `abort` 直接变成 `closed` 终态，前端会立即掉出连接态，无法自然继续下一条消息

**影响**: “停止”后的状态变成“仍已连接，但空闲可继续输入”，更符合聊天产品直觉。

---

### 7. 连接状态判定从“补丁探测”收敛为“事件驱动”

**设计文档**: 只强调 SSE 自动重连，没有明确前端如何判定“真的连上了”。

**实际实现** (2026-06-17 晚):
- ✅ 早期实现曾用 `setTimeout(checkConnection, 100)` + `readyState === OPEN` 做补丁式探测
- ✅ 现已移除这段逻辑，连接状态只以 `EventSource.onopen` / `onmessage` 为准

**动机**:
1. 避免底层 `readyState` 短暂变化时，UI 过早显示“已连接”
2. 让连接态与“真正收到可用事件流”保持一致

**影响**: 前端连接状态更符合用户感知，也减少了重连过程中的竞态窗口。

---

### 8. turn_end 不再预创建空 assistant 气泡

**设计文档**: 只定义了 `TurnEndEvent` 表示“一轮结束”，并未要求前端主动插入空消息容器。

**实际实现** (2026-06-17 晚):
- ✅ 早期 `useSession.ts` 会在收到 `turn_end` 后追加一条空 assistant 消息
- ✅ 现已移除该行为；只有后续 `delta/block` 真正到来时，才按需创建 assistant 气泡

**动机**:
1. 避免界面底部出现空白 assistant 块
2. 保持时间线只呈现真实内容，而不是先造占位容器

**影响**: 对话流更干净，也更接近常见聊天产品的直觉。

---

### 9. 鉴权从“宽松兼容”收敛为“标准 Bearer + 受限 query token”

**设计文档**: 只写“所有 `/api` 和 SSE 继续要求 token”，没有把 Bearer 头和 query token 的边界说清楚。

**实际实现** (2026-06-17 晚):
- ✅ `Authorization` 头现已要求标准 `Bearer ` 前缀
- ✅ 普通 REST API 不再接受 query token
- ✅ query token 仅保留给浏览器原生受限场景：
  - `GET /api/events`
  - `GET /api/image`
  - `GET /api/sessions/:runId/stream`

**动机**:
1. 降低误把其它 Authorization 方案当作 token 的风险
2. 把“因浏览器能力受限而妥协”的范围压缩到最小

**影响**: 鉴权边界更清晰；但 URL 中携带 token 仍是长期要继续演进的折中方案。

---

### 10. 浏览 SSE 生命周期补齐到显式 disconnect

**设计文档**: 重点描述了续聊 SSE 与 Hub 重放，但没有把“浏览历史用的 `/api/events` SSE 由谁持有、何时释放”说清楚。

**实际实现** (2026-06-17 夜):
- ✅ `ApiClient` 现已新增 `disconnect()`，用于主动关闭内部持有的浏览 SSE `EventSource`
- ✅ `App.tsx` 在用户退出登录时会显式调用 `apiClient?.disconnect()`
- ✅ 这补齐了“运行 SSE”与“浏览 SSE”两条链路的资源释放语义

**动机**:
1. 避免登出后旧浏览 SSE 仍留在内存里、继续尝试接收文件变更
2. 让 `ApiClient` 不再只有“返回 cleanup 函数”的隐式释放方式，而是具备明确的生命周期接口

**影响**: 浏览态 SSE 的生命周期现在与登录态绑定得更清晰，登出后的资源清理也更完整。

---

### 11. 静态 token 失效时补齐自动退回登录

**设计文档**: 早期设计默认“登录态 = 本地保存 token”，但没有把“服务端返回 401 后前端该如何收口”写清楚。

**实际实现** (2026-06-17 夜):
- ✅ `ApiClient.request()` 在浏览类 REST 请求收到 `401 Unauthorized` 时，会触发上层 `onUnauthorized`
- ✅ `App.tsx` 会在该回调中统一清理 `sessionStorage.authToken` 与 `cc-web-activeRuns`
- ✅ 同时主动关闭浏览 SSE `EventSource`，并直接退回 `Login`

**动机**:
1. 避免 token 已失效时，界面仍停留在“看起来已登录、实际上所有请求都 401”的坏状态
2. 让“静态 token 登录”具备最基本的一致性收口：要么正常工作，要么直接回到登录页重新输入

**影响**: 当前产品虽然仍是静态 token 模式，但用户面对 token 失配时的体验更符合直觉，也更便于定位问题。

---

### 12. develop 恢复为长期分支，并引入 GitHub Actions CI

**设计文档**: 早期文档只描述了本地 `npm test` / `npm run build`，没有定义远端分支策略和 CI 触发方式。

**实际实现** (2026-06-18):
- ✅ `develop` 明确保留为长期开发分支，不再在合并 PR 后自动删除
- ✅ 新增 `.github/workflows/ci.yml`
- ✅ CI 只对 `develop` 触发：
  - `push` 到 `develop`
  - `pull_request` 的目标分支为 `develop`
- ✅ 远端校验步骤保持与本地一致：
  - `npm ci`
  - `npm run build`
  - `npm test`
- ✅ 已补充一个契约测试 `packages/shared/src/ciWorkflow.test.ts`，约束 workflow 文件存在、触发分支正确、并执行安装/构建/测试

**动机**:
1. `develop` 需要作为持续集成与日常开发的稳定落点，不能在一次 PR 合并后被顺手删掉
2. 让“本地通过”之外，再有一层 GitHub 远端的干净环境验证
3. 保持 CI 足够简单，先围绕主开发分支建立最可靠的反馈链路

**影响**:
- 以后改动只要推到 `develop`，就会自动触发一轮完整构建与测试
- 可直接用 `gh run list / view / watch` 读取 CI 结果和日志，无需手动翻网页

---

### 12. 文档附件预览从“可打开”补齐到“可回收”

**设计文档**: 只关注对话中展示图片/文档，没有明确文档附件在新窗口预览后的 Blob URL 生命周期。

**实际实现** (2026-06-17 夜):
- ✅ 文档点击预览时，base64 已按原始字节构造 Blob
- ✅ 新窗口加载完成后会 `URL.revokeObjectURL(url)`，避免反复点击附件时累积 Blob URL

**动机**:
1. 文档附件和图片附件一样，本质上都属于浏览器侧临时对象资源
2. “能打开”不等于“资源闭环完整”，长时间使用时仍要避免泄漏

**影响**: 反复点击历史文档附件不会持续积累未释放的 Blob URL，前端资源回收更完整。

---

### 13. 会话切换从“隐式 release”演进为“只切视图，不杀 agent”

**设计文档**: 早期默认把“切换到别的会话/新建新会话”和“释放当前活跃 run”绑定在一起。

**实际实现** (2026-06-18):
- ✅ 前端普通切换会话时，不再默认调用 `DELETE /api/sessions/:runId`
- ✅ 切换只会让 `useSession(runId)` 关闭旧 SSE 连接，并把 UI 挂到新的 `runId`
- ✅ 真正结束某个后台 agent，必须显式调用 `POST /api/sessions/:runId/close`

**影响**: 切换后再切回更快，因为后端 run 没有被悄悄 release 掉；也为后台运行列表提供了稳定的生命周期基础。

---

### 14. ActiveRuns 从“续聊辅助索引”升级为“后台运行管理配角”

**设计文档**: 之前更关注 `activeRuns(sessionId -> runId)` 的恢复作用。

**实际实现** (2026-06-18):
- ✅ `activeRuns` 继续用于“历史续聊自动接管”
- ✅ 但“当前后台到底活着哪些 run、数量多少、状态如何”已经改以后端 `GET /api/sessions/active` 为准
- ✅ 新增 `POST /api/sessions/:runId/close` 作为后台运行的显式关闭接口

**影响**: 侧栏“后台运行中”现在既能包含“历史续聊 run”，也能包含“纯新建 run”，前端接管与关闭动作都更一致；若当前历史会话已在后端后台列表中，前端会自动挂接并补写 `activeRuns`，不再要求用户重新点击连接。

---

### 15. 快捷新建从“只会 prompt 输入路径”演进到“复用已有项目目录”

**设计文档**: 早期只有“新建对话”概念，没有明确区分“手动目录新建”和“从已有项目直接新建”。

**实际实现** (2026-06-18):
- ✅ 侧边栏顶部“新建会话”优先使用第一个已知项目路径；没有项目时才回退到手动目录输入
- ✅ 每个项目标题右侧新增“快速新建”，直接复用该项目 `path`
- ✅ 用户无需重复输入已经存在于侧边栏模型中的目录

**影响**: 新建会话的主流路径明显更顺手，也更贴近用户对“项目工作台”的习惯。

---

### 16. 并发上限从 4 收紧为 3，并进入产品 UI

**设计文档**: 默认并发上限长期写成 4，且更多停留在服务端保护层。

**实际实现** (2026-06-18):
- ✅ `MAX_CONCURRENT_SESSIONS` 默认值从 4 改为 3
- ✅ 后端超限时统一返回 `409`
- ✅ 前端 Sidebar 与状态栏都开始显示“已达后台运行上限，请先关闭一个”
- ✅ 新建、续聊、项目级快速新建在到达上限时都进入禁用/提示态

**影响**: 并发上限从“后台实现细节”提升成了可感知的产品规则。

---

### 17. 用户模型从“Agent 中心”收敛为“会话中心”

**设计文档**: 早期为了暴露后端 SDK 进程，UI 直接使用“活跃 agent / 后台 Agents”等技术术语，容易让用户误以为列表存在就等于当前浏览器已连接。

**实际实现** (2026-06-18):
- ✅ UI 统一称为“后台运行”，不再把 SDK agent 作为用户需要理解的主概念
- ✅ 顶部连接态改为“已接管 / 连接中 / 后台运行中 / 未接管”
- ✅ 历史会话行可显示“后台运行”徽标，表示后端已有可接管 run
- ✅ 顶部按钮统一为“接管/继续”；若当前会话已有后台运行，则显示“接管后台运行”
- ✅ “停止”只停止当前轮次，不释放后台运行；“关闭后台运行”才释放并发槽

**影响**: 用户围绕“会话”理解系统，不需要区分 `sessionId`、`runId`、SSE 连接和 SDK agent。技术边界仍然保留，但产品语义更贴近直觉。

---

## 🔧 术语演进

| 设计文档 | 实际实现 | 说明 |
|---------|---------|------|
| `ClaudeSessionManager` | `SessionManager` | 去掉 Claude 前缀，更通用 |
| `InteractionManager` | `PendingRegistry` | 强调"登记表"语义 |
| `InteractionCard` | `PendingPrompt` | 强调"待答"（pending）语义 |
| `interaction` | `prompt` | 统一用 prompt 指代待答事项 |
| `runner` | `session` | 统一用 session 指代单个会话实例 |
| `SESSION_IDLE_TIMEOUT` | `SESSION_IDLE_TIMEOUT_MS` | 明确单位为毫秒 |

---

## 📊 功能范围变更

### 已实现但设计标注"非目标"

- **删除历史会话**: `DELETE /api/projects/:projectId/sessions/:sessionId` 已实现
- **附件上传**: `POST /api/uploads` + `Composer.tsx` 附件按钮已实现

### 设计覆盖但实际简化

- **diff 生成**: 已实现轻量版，未完全达到初版设计的复杂度（见上）
- **组件拆分**: 设计建议更细致的拆分，实际保留部分逻辑在 `Conversation.tsx`

---

## 🎯 设计文档更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-06-14 | 初版设计文档（历史浏览 + 实时续聊） |
| 2026-06-16 | 根据实际实现更新：API 路径、配置项、生命周期、事件类型、项目结构 |
| 2026-06-16 | 新建 `DESIGN-EVOLUTION.md` 记录架构演进与未实现功能 |
| 2026-06-16 | 新建 `TECH-DEBT.md` 记录已知问题与改进规划 |
| 2026-06-17 | 同步 DiffBuilder 已实现、虚拟滚动落地、重连防闪烁策略 |
| 2026-06-17（晚） | 同步连接态判定收敛、空 assistant 占位移除、Bearer 边界收紧 |
| 2026-06-17（夜） | 同步浏览 SSE 显式 disconnect、文档附件 Blob URL 回收、前端调试日志清理 |
| 2026-06-17（深夜） | 同步“切换会话不断连”“停止只停当前轮次”“run 探活恢复”语义 |
| 2026-06-18 | 同步后台运行列表、项目级快速新建、切换只切视图、默认上限改为 3 |
| 2026-06-18 | 同步会话中心用户模型：接管/继续、后台运行中、停止不关闭 |

---

## 📚 相关文档

- [2026-06-14-cc-web-design.md](./2026-06-14-cc-web-design.md) — 总体设计（已更新至实际实现）
- [2026-06-14-cc-web-realtime-conversation-design.md](./2026-06-14-cc-web-realtime-conversation-design.md) — 实时续聊设计（待更新）
- [TECH-DEBT.md](../../TECH-DEBT.md) — 技术债务与改进规划
- [CLAUDE.md](../../../CLAUDE.md) — 项目概述与架构

---

**维护者**: 本文档应在架构重大调整时同步更新。若设计意图与实现再次产生偏离，优先更新本文档而非逐一修正设计文档，以保留演进脉络。
