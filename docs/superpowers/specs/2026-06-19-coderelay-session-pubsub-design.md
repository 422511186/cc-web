# CodeRelay 会话发布订阅与消息模型设计

日期：2026-06-19

## 背景

当前 CodeRelay 已经支持 Host HTTP、Web 前端、Signal 信令、WebRTC DataChannel 与 P2PTransport 业务承载。但实时会话仍然偏向“单个前台页面接管一个会话”的模型：`chatRoutes` 的 Hub 概念是 append-only 日志加当前通道，适合重连回放，却不足以表达多个 Web/P2P 前台页面同时打开同一个会话、同时发送消息、同时处理权限卡片的场景。

本设计把实时会话升级为 Host 内部的发布订阅模型。多个前台页面是平等控制端，Host 是唯一状态提交者。

## 目标

- 同一个会话允许多个 Web/P2P 客户端同时订阅。
- 每个客户端都可以发送消息、回答权限请求、批准 plan、切换 Claude 模式、停止当前回合。
- Claude 忙碌时新消息进入队列，而不是被拒绝或覆盖。
- 权限卡片和 plan 审批使用“先到先得”：第一个有效回答生效，后续回答收到已处理提示。
- 普通聊天消息不显示来源；竞争操作结果显示处理设备的友好名称。
- Claude 模式变为会话级状态，并同步给所有订阅者。
- 保持 HTTP 与 P2P 两种传输实现可复用同一套业务协议。

## 非目标

- 不做多账号、多用户权限分级。
- 不做多人协作文档式光标、输入中状态、逐字草稿同步。
- 不实现自研 Transit 中继。P2P 失败后的第一阶段中继仍使用标准 TURN/coturn。
- 不改变 Claude Agent SDK 的核心运行方式，只在 Host 会话状态层封装队列和事件总线。

## 核心模型

### SessionBus

每个 active run/session 对应一个 `SessionBus`。它持有：

- `runId`：当前活跃会话 ID。
- `log`：append-only 事件日志，用于新订阅者回放。
- `subscribers`：多个订阅者出口，可以是 SSE，也可以是 P2P DataChannel。
- `state`：会话状态快照，包括 `status`、`mode`、`pendingPrompts`、`queue`、`closed` 等。
- `operationRegistry`：已提交操作和已解决 prompt，用于去重与先到先得。

现有 Hub 的职责会被拆清楚：事件日志和广播属于 `SessionBus`；SSE/P2P 只是订阅出口；HTTP/P2P POST 请求只是操作入口。

### Client

每个前台页面或手机端都有稳定 `clientId`。绑定设备有 `deviceId` 和友好 `displayName`。同一设备打开多个页面时，可以额外生成短生命周期 `tabId`，用于诊断和日志，但用户界面默认只展示设备名。

普通消息不显示“来自哪个设备”。以下场景显示来源：

- 权限卡片已由某设备处理。
- plan 已由某设备批准或拒绝。
- 设备被 Host 撤销。
- 调试面板、Host 管理页、事件日志。

## 操作模型

客户端所有写操作统一进入 Host：

```ts
type ClientOperation =
  | SendMessageOperation
  | ResolvePromptOperation
  | ChangeModeOperation
  | AbortTurnOperation
  | CloseSessionOperation;
```

每个操作包含：

- `operationId`：客户端生成或 Host 补齐的幂等 ID。
- `runId`。
- `clientId`。
- `deviceId`。
- `createdAt`。
- `payload`。

Host 对同一个 `runId` 串行提交操作。重复 `operationId` 返回第一次提交结果，避免网络重试造成重复发消息或重复审批。

## 消息队列

Claude 正在回复或等待权限处理时，新的用户消息进入 FIFO 队列。

事件流需要表达队列生命周期：

- `message_queued`：消息进入队列。
- `message_processing`：该消息开始送入 Claude。
- `message_completed`：该消息对应回合完成。
- `message_failed`：该消息处理失败。

如果当前回合正在等待权限或 plan，队列保持等待。权限处理完成后继续当前回合；当前回合 `turn_end` 后再处理下一条队列消息。

停止当前回合只中止当前正在执行的 Claude 回合，不清空队列，除非调用方明确选择“停止并清空队列”。第一阶段 UI 只提供停止当前回合。

## 权限与 Plan 先到先得

`PendingRegistry` 需要从“等待一个回答”升级为“可竞争提交”：

1. Claude 触发权限或 plan 请求，Host 生成 `promptId` 并广播 `prompt_pending`。
2. 多个客户端都可以提交 `ResolvePromptOperation`。
3. Host 原子检查 `promptId` 是否仍 pending。
4. 第一个有效回答变更状态为 resolved，并继续 Claude 回合。
5. Host 广播 `prompt_resolved`，携带 `resolvedByDeviceName` 和决策结果。
6. 后续回答返回业务错误 `prompt_already_resolved`，前端把卡片置为“已由某设备处理”。

这条规则适用于：

- AskUserQuestion。
- canUseTool 权限确认。
- ExitPlanMode plan 审批。

## 会话级 Claude 模式

会话维护 `mode`，而不是每个浏览器本地维护。第一阶段支持：

- `auto`：默认推荐模式，由 Host 根据当前场景映射到安全的 SDK 配置。
- `plan`：倾向计划/审批流程，UI 明确显示当前会话处于计划模式。
- `bypassPermissions`：高风险模式，切换时前端必须有醒目的确认。

模式变化通过 `mode_changed` 广播给所有订阅者。后续消息默认使用当前会话模式。

实现上需要先确认 Agent SDK 对模式切换的粒度。如果 SDK 只能在启动 query 时设置权限模式，则新模式从下一次 Claude query 生效；当前正在执行的回合不强行中断。UI 需要显示“当前回合仍使用旧模式，下一条消息生效”或等价提示。

## 事件协议

事件流继续保持 append-only，可回放。需要新增或规范以下事件：

```ts
type SessionBusEvent =
  | { type: "subscriber_joined"; clientId: string; deviceName?: string }
  | { type: "subscriber_left"; clientId: string }
  | { type: "message_queued"; operationId: string; queuePosition: number }
  | { type: "message_processing"; operationId: string }
  | { type: "message_completed"; operationId: string }
  | { type: "message_failed"; operationId: string; message: string }
  | { type: "prompt_pending"; prompt: PendingPrompt }
  | { type: "prompt_resolved"; promptId: string; resolvedByDeviceName: string; decision: string }
  | { type: "mode_changed"; mode: ClaudeSessionMode; changedByDeviceName: string }
  | { type: "queue_changed"; pendingCount: number }
  | ExistingServerEvent;
```

前端 reducer 必须幂等处理回放事件：

- 相同 `operationId` 的队列事件不能重复插入。
- 同一 `promptId` 只能有一个最终 resolved 状态。
- 最后一个 `mode_changed` 决定当前模式。
- 终态事件仍以最后一个为准，但续聊前要保留现有 `resetHub` 碰撞防护。

## HTTP 与 P2P 传输

业务层继续通过 `ApiClient`/transport 抽象访问 Host。HTTP 和 P2P 的差异只在传输层：

- HTTP：REST + SSE。
- P2P：DataChannel request/response + event subscription。

两者共用同一套操作类型、事件类型、错误码。前端不应该在业务组件里判断“这是 HTTP 还是 P2P”；只显示当前连接类型和链路状态。

## 上传边界

第一阶段 UI 只暴露图片上传入口。Host 现有通用上传能力不立即删除，以免破坏已有协议和测试；但 Web Composer 的常规入口只接受图片。P2PTransport 继续支持已有请求格式。

后续如果确认完全不需要附件，可另开一次清理，把 Host 通用上传收窄为图片上传。

## 错误处理

- `prompt_already_resolved`：提示“已由某设备处理”，卡片进入只读结果态。
- `operation_duplicate`：返回第一次提交结果，前端不弹错。
- `session_closed`：提示会话已结束，引导重新接管或新建会话。
- `device_revoked`：立即断开 P2P，显示重新授权引导。
- `mode_change_deferred`：模式已记录，但当前 Claude 回合不受影响，下轮生效。
- `queue_overflow`：如果后续设置队列上限，前端提示稍后再试。

## 测试策略

必须按 TDD 实现。建议测试顺序：

1. Host 单元测试：`SessionBus` 支持多个 subscriber，广播不互相覆盖。
2. Host 单元测试：同一 `promptId` 两个回答先到先得，后到返回 `prompt_already_resolved`。
3. Host 单元测试：忙碌时多条消息按 FIFO 排队并依次送入 fake SDK。
4. Host 单元测试：`operationId` 幂等，重试不重复入队。
5. Shared 类型测试：新增事件和错误码被 HTTP/P2P 共用。
6. Web reducer 测试：事件回放幂等，prompt resolved 后卡片只读。
7. Web 组件测试：模式切换会更新所有订阅状态，高风险模式有确认。
8. P2P transport 测试：DataChannel 订阅事件与 HTTP SSE 语义一致。
9. E2E：两个浏览器页面打开同一会话，一个发消息、另一个批准权限，两个页面都看到一致结果。

## 兼容与迁移

- 旧的单订阅 SSE 客户端仍能作为一个 subscriber 工作。
- 现有 `ServerEvent` 不删除，只新增事件。
- `Hub.log` 的宽限期和重放机制保留，但底层广播改为多 subscriber。
- 现有 active session 生命周期和 `resetHub(sessionId)` 防护必须保留。

## 验收标准

- 两个 Web 页面同时打开同一 run，不会互相挤掉事件连接。
- 任意页面发送消息，所有页面都能看到队列状态和最终回复。
- 任意页面处理权限卡片，只有第一个回答生效，所有页面显示一致结果。
- 会话模式切换后，所有页面同步显示当前模式。
- P2P 和 HTTP 下的业务行为一致。
