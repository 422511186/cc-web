# Active Agent Management And Quick New Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 cc-web 增加“项目级快速新建会话”和“活跃 agent 列表 / 切换 / 关闭 / 3 个上限”能力，同时保持历史续聊与纯新建 run 的兼容行为。

**Architecture:** 后端以 `SessionManager` 作为活跃 agent 真相源，新增枚举和强制关闭接口；前端在 `App.tsx` 维护活跃 agent 轮询状态，并把 Sidebar 分成“创建区 / 活跃 agents / 项目历史区”。会话切换时不再调用 release，而只断开当前 SSE。

**Tech Stack:** TypeScript, Express, React, Vitest, Testing Library

---

### Task 1: 后端活跃 agent 枚举与上限错误

**Files:**
- Modify: `packages/server/src/session.ts`
- Modify: `packages/server/src/sessionManager.ts`
- Modify: `packages/server/src/chatRoutes.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/config.test.ts`
- Modify: `packages/server/src/sessionManager.test.ts`
- Modify: `packages/server/src/chatRoutes.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/api.ts`

- [x] Step 1: 先写失败测试，描述默认上限为 3、active 列表接口和 close 接口
- [x] Step 2: 运行相关 Vitest 用例，确认失败原因符合预期
- [x] Step 3: 实现 `ActiveAgent` 共享类型、`Session.getStatus()`、`SessionManager.listActiveAgents()`
- [x] Step 4: 实现 `GET /api/sessions/active` 与 `POST /api/sessions/:runId/close`
- [x] Step 5: 把 `MAX_CONCURRENT_SESSIONS` 默认值从 4 改为 3，并把 startNew/startContinue 的超限错误转为 409 JSON
- [x] Step 6: 重跑后端相关测试直到全绿

### Task 2: 前端 chatApi 与 App 活跃 agent 状态流

**Files:**
- Modify: `packages/web/src/chatApi.ts`
- Modify: `packages/web/src/chatApi.test.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/App.test.tsx`

- [x] Step 1: 先写失败测试，覆盖获取 active agents、关闭 agent、切换会话时不再调用 `closeSession`
- [x] Step 2: 运行前端对应测试，确认失败
- [x] Step 3: 实现 `listActiveAgents()`、`closeAgent()` API 封装
- [x] Step 4: 在 `App.tsx` 中加入 `activeAgents` / `maxAgents` 状态与轮询刷新
- [x] Step 5: 改写切换逻辑：视图切换不再 release 旧 run，仅通过 `runId` 切换关闭旧 SSE
- [x] Step 6: 实现 active agent 点击切换 continue/new 两类 run
- [x] Step 7: 重跑前端相关测试直到全绿

### Task 3: Sidebar 快捷新建与活跃 agent 面板

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/Sidebar.test.tsx`

- [x] Step 1: 先写失败测试，覆盖项目级快速新建、活跃 agent 列表渲染、关闭按钮、上限禁用态
- [x] Step 2: 运行 Sidebar 测试，确认失败
- [x] Step 3: 实现顶部“自定义目录新建”和项目标题右侧“快速新建”
- [x] Step 4: 实现“活跃 Agents n/3”面板、状态展示、点击切换与关闭
- [x] Step 5: 达上限时禁用新建入口并展示明确提示
- [x] Step 6: 重跑 Sidebar 和 App 相关测试直到全绿

### Task 4: 文档同步与最终验证

**Files:**
- Modify: `docs/superpowers/specs/2026-06-14-cc-web-design.md`
- Modify: `docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md`
- Modify: `docs/superpowers/specs/DESIGN-EVOLUTION.md`

- [x] Step 1: 把默认并发上限、活跃 agent 管理、新的切换语义同步到设计文档
- [x] Step 2: 运行 `npm test`
- [x] Step 3: 运行 `npm run build`
- [x] Step 4: 启动前后端服务并记录本地访问地址
