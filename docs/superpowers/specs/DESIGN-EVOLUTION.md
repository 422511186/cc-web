# cc-web 设计演进记录

> 本文档记录设计文档与实际实现之间的关键差异、架构演进与未实现功能。
> 
> 最后更新：2026-06-16

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

**技术债务**: Hub.log 无界增长（见 `docs/TECH-DEBT.md` P1-1），长会话可能内存泄漏。

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
   - 忙碌 → 保留在池，后台跑，等待重连
   - 空闲 → detach 回收
2. **detach()**: 优雅分离，不 abort，让后台任务自然结束
3. **close()**: 强制中止，发送 abort 信号

**用户价值**: 切换会话时，正在执行的任务（如长时间编译）不会被中断，切回时能看到完整结果。

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

## ❌ 未实现功能

### 1. DiffBuilder 与实时 diff 生成

**设计文档**: `2026-06-14-cc-web-realtime-conversation-design.md` 第 87-105 行详细设计了 DiffBuilder 模块，从 Edit/MultiEdit/Write 工具生成 unified diff。

**实际状态**: 
- **未实现**：无独立 `DiffBuilder` 模块
- **现状**: 权限卡片只显示工具参数摘要（`session.ts` 第 280 行 `summarizeInput` 函数）
- **替代方案**: `DiffView.tsx` 仅用于展示历史 JSONL 中已有的 diff 信息

**影响**: 用户在权限确认前无法预览具体代码改动，只能看到抽象参数（如文件路径）。

**后续计划**: 见 `docs/TECH-DEBT.md` 第三阶段优化。

---

### 2. InteractionCard 统一组件

**设计文档**: 建议创建 `InteractionCard` 组件，根据 `kind` 渲染不同卡片。

**实际状态**: 
- **未实现**: 三个卡片组件独立存在（`QuestionCard.tsx` / `PermissionCard.tsx` / `PlanCard.tsx`）
- **现状**: `Conversation.tsx` 内联判断 `prompt.kind` 并渲染对应卡片

**影响**: 代码略显冗余，但功能完整。

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

- **diff 生成**: 设计详细但未实现（见上）
- **组件拆分**: 设计建议更细致的拆分，实际保留部分逻辑在 `Conversation.tsx`

---

## 🎯 设计文档更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-06-14 | 初版设计文档（历史浏览 + 实时续聊） |
| 2026-06-16 | 根据实际实现更新：API 路径、配置项、生命周期、事件类型、项目结构 |
| 2026-06-16 | 新建 `DESIGN-EVOLUTION.md` 记录架构演进与未实现功能 |
| 2026-06-16 | 新建 `TECH-DEBT.md` 记录已知问题与改进规划 |

---

## 📚 相关文档

- [2026-06-14-cc-web-design.md](./2026-06-14-cc-web-design.md) — 总体设计（已更新至实际实现）
- [2026-06-14-cc-web-realtime-conversation-design.md](./2026-06-14-cc-web-realtime-conversation-design.md) — 实时续聊设计（待更新）
- [TECH-DEBT.md](../../TECH-DEBT.md) — 技术债务与改进规划
- [CLAUDE.md](../../../CLAUDE.md) — 项目概述与架构

---

**维护者**: 本文档应在架构重大调整时同步更新。若设计意图与实现再次产生偏离，优先更新本文档而非逐一修正设计文档，以保留演进脉络。
