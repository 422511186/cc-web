# 后台运行管理与快捷新建会话设计

> 状态：已批准（用户授权由实现方自行决策并直接推进）
> 日期：2026-06-18

## 1. 背景

当前实现里：

1. 新建会话主要依赖输入目录路径，虽然侧边栏已经知道项目目录，但不能直接基于已有项目快速创建。
2. 前端切换到别的会话时，会主动调用 `DELETE /api/sessions/:runId` 释放当前 run；这会让“切走再切回”“停止后继续输入”“观察多个后台运行”这些体验都偏脆弱。
3. Web 端无法直接看到当前后端到底活着多少个 SDK agent，也没有统一的“切过去 / 关闭它”的管理入口。

用户的新要求是把“后台运行”做成一等能力，同时避免把 SDK agent 这种实现细节暴露给普通操作流：

- 侧边已有项目时，应支持直接快速新建，不必再手输路径
- Web 端要能看到当前后台运行数量、状态、并快速接管
- 允许显式关闭某个后台运行
- 后台运行上限固定为 3，超限时禁止再启动并给出明确引导

产品模型统一为“会话为中心”：

- 历史会话是内容容器，打开历史会话默认只读，不启动 SDK。
- 后台运行是可接管的执行状态，可能没有当前浏览器 SSE 连接。
- “接管/继续”是一个统一动作：已有后台运行则接管；没有后台运行才启动续聊。
- “停止”只停止当前 Claude 回合，保留接管状态和输入能力。
- “关闭后台运行”才终止 SDK agent 并释放并发名额。

## 2. 目标

本次设计解决三类问题：

1. **快捷新建**：从侧边栏的现有项目直接创建新会话
2. **后台运行可见**：前端展示当前 `SessionManager` 中仍活着的 run 列表
3. **后台运行可控**：支持接管、关闭、状态查看与 3 个上限约束

非目标：

- 不引入新的多用户 / 多令牌模型
- 不把历史 session 和后台运行混成同一数据源；历史列表仍以 JSONL 浏览结果为准
- 不改变底层“runId / sessionId”核心语义

## 3. 核心取舍

### 3.1 切换会话不再等于释放 agent

现有前端在切换会话或新建会话前会调用 `closeSession()`，对应后端 `release()` 语义。这样虽然节省并发槽，但不符合“后台 agent 池可观察、可切换、可手动关闭”的产品要求。

本次改为：

- **切换当前查看目标时，只关闭前端旧 SSE 连接，不再请求后端 release**
- 后台运行继续留在 `SessionManager` 中，占用 3 个名额之一
- 用户要真正结束后台运行，必须点击“关闭后台运行”
- 后端原有 idle timeout 继续保留，作为兜底回收机制

这样可以把“连接视图切换”和“进程生命周期结束”彻底拆开。

### 3.2 后台运行的真相源改为后端枚举

当前前端用 `activeRunsRef(sessionId -> runId)` 记续聊 run，主要用于“切回同一历史会话时自动恢复”。这只覆盖了历史续聊，不覆盖纯新建 run，也无法准确反映后台到底还活着什么。

本次改为：

- `SessionManager` 提供“后台运行枚举”能力
- 前端通过新 API 获取后台运行列表与上限
- `activeRunsRef` 继续保留，但只作为“历史续聊自动接管”的辅助索引
- 真正的后台运行状态、数量、状态机都以后端枚举为准

## 4. 数据模型

新增共享类型 `ActiveAgent`：

- `runId: string`
- `kind: "new" | "continue"`
- `sessionId: string | null`
- `projectId?: string`
- `cwd?: string`
- `status: "idle" | "executing" | "waiting"`
- `createdAt: number`
- `lastEventAt: number`

新增响应：

- `GET /api/sessions/active`
- 返回 `{ agents: ActiveAgent[]; maxConcurrent: number }`

说明：

- `kind="continue"` 的后台运行可映射回历史 session 视图
- `kind="new"` 的后台运行没有历史 session，点击后进入纯实时新会话视图
- `projectId` 仅用于前端把后台运行重新挂回现有项目语境

## 5. 后端设计

### 5.1 Session 暴露运行状态

`Session` 新增只读状态访问器，用来把当前状态稳定映射为：

- `executing`
- `waiting`
- `idle`

不引入新的状态枚举，复用已有事件语义。

### 5.2 SessionManager 记录后台运行元信息

`SessionManager.entries` 的每个 entry 追加元信息：

- kind
- projectId
- sessionId
- cwd
- createdAt
- lastEventAt

并新增 `listActiveAgents()`，统一返回当前池中的后台运行。

### 5.3 新增后台运行管理路由

新增两个接口：

1. `GET /api/sessions/active`
   - 返回后台运行列表和 `maxConcurrent`
2. `POST /api/sessions/:runId/close`
   - 强制关闭指定后台运行
   - 调用 `SessionManager.close(runId, "aborted")`

保留现有：

- `GET /api/sessions/:runId` 探活
- `POST /api/sessions/:runId/heartbeat` 刷新浏览器接管租约
- `DELETE /api/sessions/:runId` release 语义

但前端主流程将不再在切换时主动调用 release。

路由分流约束：

- 历史详情接口仍是 `GET /api/sessions/:sessionId?projectId=...`
- `projectId` 是历史详情路由的判定条件；没有 `projectId` 时必须向后传递给实时会话路由
- 这样 `GET /api/sessions/active` 与 `GET /api/sessions/:runId` 探活不会被历史详情路由误判为缺少 `projectId` 的历史请求

### 5.4 并发上限默认改为 3

配置默认值从 4 调整到 3：

- `MAX_CONCURRENT_SESSIONS` 默认值改为 `3`
- `SESSION_HEARTBEAT_TTL_MS` 默认 `45000`
- `SESSION_ORPHAN_IDLE_TIMEOUT_MS` 默认 `60000`

同时：

- `POST /api/sessions/new`
- `POST /api/sessions/:id/continue`

在命中上限时返回 `409` 和明确错误消息，而不是落成笼统的 500。

## 6. 前端设计

### 6.1 Sidebar 新结构

侧边栏分三块：

1. **顶部创建区**
   - “新建会话”优先使用第一个已知项目路径直接创建；没有项目时才回退到目录输入框
   - “快速新建当前项目”与项目标题右侧“快速新建”都必须接到同一个 `startNew(cwd)` 流程；成功后进入纯新建会话视图并清空历史 session URL query
2. **后台运行中**
   - 显示 `n / 3`
   - 每项可点击接管
   - 每项可关闭后台运行
   - 显示中文运行状态（空闲 / 执行中 / 等待你回答）
3. **项目 / 历史会话**
   - 项目标题右侧新增“快速新建”按钮
   - 直接用该项目的真实路径发起 `startNew`
   - 如果该历史会话有对应后台运行，显示“后台运行”徽标

### 6.2 后台运行接管规则

点击后台运行：

- 若 `kind="continue"` 且有 `projectId + sessionId`
  - 进入该历史会话页
  - 直接挂接对应 `runId`
  - 同步写回 `activeRuns(sessionId -> runId)`，后续切走再切回不再要求重新点击连接
- 若 `kind="new"`
  - 进入纯新建会话视图
  - `selectedSession = null`
  - `runId = agent.runId`

当前 URL / 当前选中历史会话若已经存在于后端 `GET /api/sessions/active` 返回的列表中，前端应自动接管对应 `runId`，而不是继续显示“接管/继续”。这条规则用于弥补 `sessionStorage` 中 `activeRuns` 丢失或过期时的恢复缺口。

切走再切回一个本地已知 `activeRuns(sessionId -> runId)` 的历史会话时，前端采用**乐观接管**：先立即设置 `runId` 并打开 SSE，让 UI 进入“连接中 / 接管中”，同时异步请求 `GET /api/sessions/:runId` 探活。只有后端明确返回 run 已不存在，或后续 SSE 收到 `closed` 终态时，才清理本地映射并回到“接管/继续”。探活请求本身不能阻塞会话切换，也不能因为瞬时失败就把用户踢回未接管态。

若当前历史会话已经有后台运行，则顶部按钮显示“接管后台运行”。此时即使后台运行数量已达上限，也允许接管，因为接管不会启动新的 SDK agent。

若当前历史会话没有后台运行，则顶部按钮显示“接管/继续”。点击后才启动新的续聊 run，并受 3 个后台运行上限约束。

### 6.3 切换时只断 UI，不杀 agent

前端切换当前查看对象时：

- 不再调用 `closeSession()`
- 只通过 `runId` 变化，让 `useSession` 自己关闭旧 `EventSource`
- 继续对 `activeRuns` 中的后台 run 发送 heartbeat，避免用户切到别的历史会话后原 run 被空闲回收

这会让后台运行保持存活，后台运行列表立即可接管。

### 6.3.1 Heartbeat 租约回收

前端每 15 秒对当前 `runId` 与本地 `activeRuns(sessionId -> runId)` 中的所有 runId 去重后发送 `POST /api/sessions/:runId/heartbeat`。heartbeat 成功表示浏览器仍在接管该 run；后端据此刷新 `leaseExpiresAt`。

后端回收规则：

- 有新鲜 heartbeat 租约的 idle run 不按普通 `SESSION_IDLE_TIMEOUT_MS` 回收。
- heartbeat 停止后，若 run 已经 idle，则等 `SESSION_ORPHAN_IDLE_TIMEOUT_MS` 后关闭并释放并发槽。
- heartbeat 停止但 run 正在 executing / waiting 时，不因为租约过期强杀；等它回到 idle 后再按 orphan idle 规则回收。
- heartbeat 返回 404 时，前端删除本地对应 `activeRuns` 映射；如果它正是当前 run，则退出接管态。
- 用户显式点击“关闭后台运行”仍然立即关闭，不等待租约过期。

### 6.4 上限体验

当前活跃数达到 3 时：

- 项目级“快速新建”按钮禁用
- 顶部“新建会话”按钮禁用
- “接管/继续”按钮禁用（仅在该历史会话还没有后台运行时）
- 文案提示“已达 3 个后台运行上限，请先关闭一个”

即使前端状态过期，后端仍会用 409 再兜底。

### 6.5 后台运行列表刷新策略

前端维护 `activeAgents` 状态，但 UI 文案统一称为“后台运行”，并在以下时机刷新：

- 登录后
- 页面首次加载后
- 成功 `startNew / startContinue / close agent / abort`
- 定时轮询（轻量轮询）用于更新后台运行状态

这样既能保持体验稳定，也不需要再为“后台运行状态广播”引入额外 SSE。

UI 命名采用“后台运行中”而不是“后台 Agents”或“已连接 Agents”：该列表表达的是后端 `SessionManager` 中仍占用并发槽的 SDK run，不等同于当前浏览器 SSE 已连接。浏览器是否已接管由顶部状态栏的“已接管 / 连接中 / 后台运行中 / 未接管”表达。

后台运行列表中的当前 run 还会额外覆盖状态文案：

- 当前浏览器已经设置 `runId` 但 SSE 尚未连接：显示“接管中”
- 当前浏览器已经设置 `runId` 且 SSE 已连接：显示“已接管”
- 非当前 run：显示后端执行状态（空闲 / 执行中 / 等待你回答）

这样用户能看懂“这个 run 已经在后端创建并占用名额，但浏览器接管还没完成”，不会把它误解成已经稳定后台运行。

## 7. 测试策略

后端：

- `SessionManager`：
  - 列表枚举
  - 状态映射
  - 元信息记录
- `chatRoutes`：
  - `GET /sessions/active`
  - `POST /sessions/:runId/close`
  - 超过上限时返回 409 友好错误
- `config`：
  - 默认上限为 3

前端：

- `Sidebar`：
  - 项目级快速新建
  - 后台运行列表渲染
  - 点击切换 / 点击关闭
  - 达上限时禁用新建
- `App`：
  - 切换会话不再调用 `closeSession`
  - 通过后台运行列表接管 continue/new 两类 run
  - 达上限时“接管/继续”禁用或给出提示
  - 停止当前轮次后仍保持接管态和输入能力
- `chatApi`：
  - 获取后台运行列表
  - 关闭后台运行

## 8. 文档同步

实现后同步更新：

- `docs/superpowers/specs/2026-06-14-cc-web-design.md`
- `docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md`
- `docs/superpowers/specs/DESIGN-EVOLUTION.md`

重点澄清：

- 前端“切换视图”与“释放后端活跃会话”已经解耦
- 后台运行是 `SessionManager` 中的活跃 run，而不是历史 session 列表
- “停止”与“关闭后台运行”必须分离：停止不释放并发槽，关闭才释放
- 默认并发上限已改为 3
