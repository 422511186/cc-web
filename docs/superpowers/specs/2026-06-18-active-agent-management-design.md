# 活跃 Agent 管理与快捷新建会话设计

> 状态：已批准（用户授权由实现方自行决策并直接推进）
> 日期：2026-06-18

## 1. 背景

当前实现里：

1. 新建会话主要依赖输入目录路径，虽然侧边栏已经知道项目目录，但不能直接基于已有项目快速创建。
2. 前端切换到别的会话时，会主动调用 `DELETE /api/sessions/:runId` 释放当前 run；这会让“切走再切回”“停止后继续输入”“观察多个后台活跃会话”这些体验都偏脆弱。
3. Web 端无法直接看到当前后端到底活着多少个 SDK agent，也没有统一的“切过去 / 关闭它”的管理入口。

用户的新要求是把“活跃 agent”做成一等能力：

- 侧边已有项目时，应支持直接快速新建，不必再手输路径
- Web 端要能看到当前活跃 agent 数量、状态、并快速切换
- 允许显式关闭某个 agent
- agent 上限固定为 3，超限时禁止再启动并给出明确引导

## 2. 目标

本次设计解决三类问题：

1. **快捷新建**：从侧边栏的现有项目直接创建新会话
2. **活跃 agent 可见**：前端展示当前 `SessionManager` 中仍活着的 run 列表
3. **活跃 agent 可控**：支持切换、关闭、状态查看与 3 个上限约束

非目标：

- 不引入新的多用户 / 多令牌模型
- 不把历史 session 和活跃 agent 混成同一数据源；历史列表仍以 JSONL 浏览结果为准
- 不改变底层“runId / sessionId”核心语义

## 3. 核心取舍

### 3.1 切换会话不再等于释放 agent

现有前端在切换会话或新建会话前会调用 `closeSession()`，对应后端 `release()` 语义。这样虽然节省并发槽，但不符合“后台 agent 池可观察、可切换、可手动关闭”的产品要求。

本次改为：

- **切换当前查看目标时，只关闭前端旧 SSE 连接，不再请求后端 release**
- 活跃 agent 继续留在 `SessionManager` 中，占用 3 个名额之一
- 用户要真正结束 agent，必须点击“关闭 agent”
- 后端原有 idle timeout 继续保留，作为兜底回收机制

这样可以把“连接视图切换”和“进程生命周期结束”彻底拆开。

### 3.2 活跃 agent 的真相源改为后端枚举

当前前端用 `activeRunsRef(sessionId -> runId)` 记续聊 run，主要用于“切回同一历史会话时自动恢复”。这只覆盖了历史续聊，不覆盖纯新建 run，也无法准确反映后台到底还活着什么。

本次改为：

- `SessionManager` 提供“活跃 agent 枚举”能力
- 前端通过新 API 获取活跃列表与上限
- `activeRunsRef` 继续保留，但只作为“历史续聊自动接管”的辅助索引
- 真正的活跃状态、数量、状态机都以后端枚举为准

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

- `kind="continue"` 的 agent 可映射回历史 session 视图
- `kind="new"` 的 agent 没有历史 session，点击后进入纯实时新会话视图
- `projectId` 仅用于前端把活跃 agent 重新挂回现有项目语境

## 5. 后端设计

### 5.1 Session 暴露运行状态

`Session` 新增只读状态访问器，用来把当前状态稳定映射为：

- `executing`
- `waiting`
- `idle`

不引入新的状态枚举，复用已有事件语义。

### 5.2 SessionManager 记录 agent 元信息

`SessionManager.entries` 的每个 entry 追加元信息：

- kind
- projectId
- sessionId
- cwd
- createdAt
- lastEventAt

并新增 `listActiveAgents()`，统一返回当前池中的活跃 run。

### 5.3 新增 agent 管理路由

新增两个接口：

1. `GET /api/sessions/active`
   - 返回活跃 agent 列表和 `maxConcurrent`
2. `POST /api/sessions/:runId/close`
   - 强制关闭指定 agent
   - 调用 `SessionManager.close(runId, "aborted")`

保留现有：

- `GET /api/sessions/:runId` 探活
- `DELETE /api/sessions/:runId` release 语义

但前端主流程将不再在切换时主动调用 release。

路由分流约束：

- 历史详情接口仍是 `GET /api/sessions/:sessionId?projectId=...`
- `projectId` 是历史详情路由的判定条件；没有 `projectId` 时必须向后传递给实时会话路由
- 这样 `GET /api/sessions/active` 与 `GET /api/sessions/:runId` 探活不会被历史详情路由误判为缺少 `projectId` 的历史请求

### 5.4 并发上限默认改为 3

配置默认值从 4 调整到 3：

- `MAX_CONCURRENT_SESSIONS` 默认值改为 `3`

同时：

- `POST /api/sessions/new`
- `POST /api/sessions/:id/continue`

在命中上限时返回 `409` 和明确错误消息，而不是落成笼统的 500。

## 6. 前端设计

### 6.1 Sidebar 新结构

侧边栏分三块：

1. **顶部创建区**
   - 保留一个“自定义目录新建”按钮
2. **活跃 Agents**
   - 显示 `n / 3`
   - 每项可点击切换
   - 每项可关闭
   - 显示运行状态
3. **项目 / 历史会话**
   - 项目标题右侧新增“快速新建”按钮
   - 直接用该项目的真实路径发起 `startNew`

### 6.2 活跃 agent 切换规则

点击活跃 agent：

- 若 `kind="continue"` 且有 `projectId + sessionId`
  - 进入该历史会话页
  - 直接挂接对应 `runId`
- 若 `kind="new"`
  - 进入纯新建会话视图
  - `selectedSession = null`
  - `runId = agent.runId`

### 6.3 切换时只断 UI，不杀 agent

前端切换当前查看对象时：

- 不再调用 `closeSession()`
- 只通过 `runId` 变化，让 `useSession` 自己关闭旧 `EventSource`

这会让后台 agent 保持存活，活跃列表立即可切回。

### 6.4 上限体验

当前活跃数达到 3 时：

- 项目级“快速新建”按钮禁用
- 自定义目录新建按钮禁用
- “在此继续”按钮禁用（仅在该历史会话还没有活跃 run 时）
- 文案提示“已达 3 个活跃 agent 上限，请先关闭一个”

即使前端状态过期，后端仍会用 409 再兜底。

### 6.5 活跃列表刷新策略

前端维护 `activeAgents` 状态，并在以下时机刷新：

- 登录后
- 页面首次加载后
- 成功 `startNew / startContinue / close agent / abort`
- 定时轮询（轻量轮询）用于更新后台运行状态

这样既能保持体验稳定，也不需要再为“后台 agent 状态广播”引入额外 SSE。

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
  - 活跃 agent 列表渲染
  - 点击切换 / 点击关闭
  - 达上限时禁用新建
- `App`：
  - 切换会话不再调用 `closeSession`
  - 通过活跃 agent 列表切换到 continue/new 两类 run
  - 达上限时“在此继续”禁用或给出提示
- `chatApi`：
  - 获取活跃 agent 列表
  - 关闭活跃 agent

## 8. 文档同步

实现后同步更新：

- `docs/superpowers/specs/2026-06-14-cc-web-design.md`
- `docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md`
- `docs/superpowers/specs/DESIGN-EVOLUTION.md`

重点澄清：

- 前端“切换视图”与“释放后端活跃会话”已经解耦
- 活跃 agent 是 `SessionManager` 中的活跃 run，而不是历史 session 列表
- 默认并发上限已改为 3
