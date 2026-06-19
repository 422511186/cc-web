# 技术债务与改进规划

> 本文档记录 cc-web 项目经深度代码审查后发现的已知问题、技术债务和改进方向。
> 
> 最后更新：2026-06-18
> 
> 来源：基于完整代码审查（后端 10 个核心模块 + 前端 10 个核心模块）

---

## 📊 问题分级

| 级别 | 数量 | 说明 |
|------|------|------|
| 🔴 P0 - 安全关键 | 3 | 需立即修复，存在安全风险或数据丢失可能 |
| 🟠 P1 - 资源泄漏 | 4 | 会导致内存泄漏或资源耗尽，影响长期稳定性 |
| 🟡 P2 - 边界条件 | 29 | 特定场景下可能失败，但不影响主流程 |
| 💡 质量改进 | 21 | 代码可维护性、性能优化、体验提升 |
| **总计** | **57** | 无崩溃级硬性 Bug |

---

## 🔥 P0 - 安全关键（需立即修复）

### 🔴 P0-1: Token 时序攻击风险

**文件**: `packages/server/src/auth.ts:20`

**问题**: 字符串 `!==` 比较存在时序侧信道，攻击者可通过高频探测逐字节爆破 `AUTH_TOKEN`

**影响**: 攻击者获取 token 后可远程执行命令、删除历史、读取所有会话记录

**修复**:
```typescript
import { timingSafeEqual } from 'node:crypto';

// 替换第 20 行的字符串比较
const bufA = Buffer.from(token);
const bufB = Buffer.from(expectedToken);
if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
  res.status(401).json({ error: 'Unauthorized' });
  return;
}
```

---

### 🔴 P0-2: Markdown XSS 漏洞

**文件**: `packages/web/src/components/Conversation.tsx:161, 919, 924`

**问题**: `dangerouslySetInnerHTML` 直接渲染 Markdown，恶意消息可执行脚本窃取 `sessionStorage` 中的 token

**影响**: 高危，XSS 可读取 token → 远程接管会话 → 执行本机命令

**修复**:
```bash
npm install dompurify @types/dompurify --workspace @cc-web/web
```

```typescript
import DOMPurify from 'dompurify';

// 替换所有 dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize(marked.parse(text)) 
}} />
```

**额外防护**: 实施 CSP 策略（禁止 inline script）

---

### 🔴 P0-3: sessionStorage 明文存储 token

**文件**: `packages/web/src/App.tsx:143, 253-255`

**问题**: XSS 可读取 `sessionStorage.authToken`，与上述 Markdown XSS 叠加成高危漏洞

**影响**: token 泄漏 → 完整 API 权限

**短期缓解**:
1. 立即修复 P0-2 Markdown XSS
2. 实施 CSP 策略

**长期方案**: 后端实现 HttpOnly Cookie 存储 + token 过期/撤销机制

---

## 🟠 P1 - 资源泄漏（影响稳定性）

### 🟠 P1-1: Hub.log 无界增长

**文件**: `packages/server/src/chatRoutes.ts:14-16`

**问题**: 事件日志永不清空，长时间会话（如数小时 loop）百万次 `delta` 可达数十 MB

**影响**: 高频输出会话耗尽内存

**修复**:
```typescript
const MAX_LOG_EVENTS = 10_000;

function appendEvent(hub: Hub, event: ServerEvent) {
  hub.log.push(event);
  if (hub.log.length > MAX_LOG_EVENTS) {
    // 保留最后 N 条，删除旧事件
    hub.log.splice(0, hub.log.length - MAX_LOG_EVENTS);
    // 可选：在截断后的首事件加标记
    if (!hub.log[0]._truncated) {
      hub.log.unshift({ type: 'status', state: 'idle', _truncated: true } as any);
    }
  }
}
```

---

### 🟠 P1-2: 前端 EventSource 未关闭

**文件**: `packages/web/src/useSession.ts:141-204`

**问题**: `runId` 变为 `null` 时，`if (!runId) return;` 提前退出，不触发 cleanup，旧 SSE 连接永不关闭

**影响**: 切换会话时内存泄漏，可能导致页面卡顿

**修复**:
```typescript
useEffect(() => {
  if (!runId) {
    // 先清理再退出
    esRef.current?.close();
    esRef.current = null;
    return;
  }
  // ... 后续逻辑
}, [runId, apply]);
```

---

### 🟠 P1-3: Blob URL 泄漏

**文件**: `packages/web/src/components/Composer.tsx:33`

**问题**: `URL.createObjectURL(file)` 创建的 URL 从不释放

**影响**: 频繁上传附件导致内存泄漏

**修复**:
```typescript
const onRemove = (index: number) => {
  const removed = attachments[index];
  if (removed.preview) URL.revokeObjectURL(removed.preview);
  setAttachments(prev => prev.filter((_, i) => i !== index));
};

// 组件卸载时清理所有
useEffect(() => {
  return () => {
    attachments.forEach(a => {
      if (a.preview) URL.revokeObjectURL(a.preview);
    });
  };
}, []);
```

---

### 🟠 P1-4: api.ts EventSource 未清理

**文件**: `packages/web/src/api.ts:72-110`

**问题**: ~~`ApiClient` 析构时 `this.eventSource` 仍存在，登出后旧连接仍尝试重连~~

**影响**: ~~内存泄漏 + 无效网络请求~~

**修复状态**: ✅ 已修复（2026-06-17）

**方案**:
- `ApiClient` 新增 `disconnect()`，显式关闭并清空内部持有的浏览 SSE `EventSource`
- `App.tsx` 在 `handleLogout()` 中调用 `apiClient?.disconnect()`
- 新增测试覆盖：
  - `api.test.ts`: `disconnect` 应主动关闭当前 `EventSource`
  - `App.test.tsx`: 登出时主动断开浏览 SSE 连接

---

## 🎯 P2 - 边界条件缺陷（29 项）

### 后端（15 项）

#### 🟡 P2-B1: sessionManager 并发检查非原子

**文件**: `packages/server/src/sessionManager.ts:31-62`

**问题**: ~~检查 `size >= maxConcurrent` 与插入 entry 之间非原子，两个 `startNew` 可能同时通过检查~~

**影响**: ~~可能超出并发上限~~

**修复状态**: ✅ 已修复（2026-06-16）

**方案**: 改为"插入后检查"——先插入 entry，再检查 size；超限则回滚（清理 timer、移除 entry、关闭 session）并抛错。新增测试覆盖并发场景（`Promise.allSettled` 验证一成功一失败）。

---

#### 🟡 P2-B2: session.ts 续聊不重置 reportedModel

**文件**: `packages/server/src/session.ts:222-225`

**问题**: ~~续聊第二轮用不同模型时，`reportedModel` 仍为第一轮的值，新模型不上报~~

**影响**: ~~前端 UI 显示旧模型名~~

**修复状态**: ✅ 已修复（2026-06-16 之前）

**方案**: 每次 `send()` 时重置 `this.reportedModel = null`（L53-54），让每轮都能重新上报模型。已有测试覆盖（"续聊第二轮用不同模型时应重新上报新模型"）。

---

#### 🟡 P2-B3: chatRoutes Hub 宽限计时器漏启

**文件**: `packages/server/src/chatRoutes.ts:70-75`

**问题**: ~~若会话结束时正好有 SSE 连接，不启动宽限计时器；若后续连接断开但未触发 `onClose`（网络闪断），hub 永久驻留~~

**修复状态**: ✅ 已修复（2026-06-17）

**方案**: 无论是否有连接都预约清理——`closed` 事件触发时始终启动宽限计时器（如果已有则先清除再重启）。这样即使 SSE 连接意外断开未触发 `onClose`，hub 也会在 60 秒后自动清理，避免永久驻留。

---

#### 🟡 P2-B4: config.ts 负数超时

**文件**: `packages/server/src/config.ts:26-31`

**问题**: ~~`SESSION_IDLE_TIMEOUT_MS=-1000` 会导致 `setTimeout` 立即触发，会话秒杀~~

**修复状态**: ✅ 已修复（2026-06-16 之前）

**方案**: 在 L40-42 校验 `idleTimeoutMs <= 0 || !isFinite(idleTimeoutMs)` 并抛错。已有完整测试覆盖：负数、零、Infinity、NaN 都会抛错。

---

#### 🟡 P2-B5: store.ts 路径穿越检测

**文件**: `packages/server/src/store.ts:189-192`

**问题**: ~~Windows 下 `path.isAbsolute(rel)` 可能误判~~

**修复状态**: ✅ 已修复（2026-06-18，补齐跨平台语义）

**方案**: 在 `deleteSession()` 入口先拒绝任何带分隔符、盘符、UNC 前缀的 `projectId/sessionId` 片段，再做 `target.startsWith(root + path.sep)` 兜底检查。这样即使 CI 运行在 Linux，也不会把 `nested/report.txt`、`C:\malicious\path`、`\\server\share` 误当成普通文件名接受。

---

#### 🟡 P2-B6: jsonl.ts CRLF 兼容性

**文件**: `packages/server/src/jsonl.ts:26`

**问题**: ~~`split('\n')` 在 Windows CRLF 下每行残留 `\r`~~

**修复状态**: ✅ 已修复（2026-06-16）

**方案**: 改用 `split(/\r?\n/)` 兼容 LF 和 CRLF 两种换行符。新增测试验证 Windows CRLF (`\r\n`) 格式的 JSONL 能正确解析为独立消息。

---

#### 🟡 P2-B7: auth.ts query token 泄漏

**文件**: `packages/server/src/auth.ts:6`

**问题**: `?token=xxx` 明文出现在 URL，Web 服务器日志会记录

**当前状态**: ⚠️ 已部分收紧（2026-06-17）

**现状**:
- `Authorization` 头现已**强制要求 `Bearer ` 前缀**
- query token 仅保留给浏览器原生受限的 `GET /api/events`、`GET /api/image`、`GET /api/sessions/:runId/stream`
- 普通 REST API 已不再接受 query token

**剩余风险**: 以上 3 类 GET URL 仍会把 token 暴露在地址栏 / 代理日志 / 服务器访问日志中。这是浏览器原生能力（`EventSource`、`<img>`）带来的折中，长期仍建议迁移到 HttpOnly Cookie 或同源受限短期票据。

---

#### 🟡 P2-B8-B15: 其他后端边界条件

- ~~inputQueue.ts:47 - 并发调用 `next()` 覆盖 `waiting` promise~~ ✅ 已修复（2026-06-17）
- pending.ts:30 - `settle` 同步执行可能阻塞响应
- ~~sdk.ts:44 - `canUseTool` 未捕获异常~~ ✅ 已修复（2026-06-17）
- store.ts:38 - 项目目录不存在时跳过（应标记离线）
- ~~store.ts:216 - UNC/Unix 路径无法解码~~ ✅ 已部分修复（2026-06-17：对非 Windows 编码目录名不再误解码并误隐藏，如 `demo-project`）
- ~~config.ts:18 - `parseInt` 失败静默降级~~ ✅ 部分收紧（2026-06-17：补充 `PERMISSION_MODE` 与 `MAX_CONCURRENT_SESSIONS` 校验）
- ~~config.ts:35 - `AUTH_TOKEN` 未校验长度（应 >=16）~~ ✅ 已修复（2026-06-17）
- sessionManager.ts:56 - 实例相等校验有纳秒级竞态窗口

**P2-B8 修复方案**: 并发调用 `next()` 时，检测到已有 `waiting`，则立即拒绝旧的 `waiting`（返回 `done=true`），只保留最新的 `waiting`。新增测试验证并发调用时旧 promise 被正确拒绝。

**P2-B12 修复方案**: 在 `loadConfig()` 中增加 `AUTH_TOKEN` 长度校验（最小 16 字符），拒绝过短的令牌。新增测试验证短令牌被拒绝、足够长的令牌被接受。更新所有测试用例使用 16+ 字符的 token。

---

### 前端（14 项）

#### 🟡 P2-F1: useSession.ts apply 无依赖数组

**文件**: `packages/web/src/useSession.ts:53`

**问题**: ~~`apply` 使用 `useCallback` 但无依赖数组，每次重渲染触发 SSE 重连~~

**影响**: ~~频繁断开重连，性能问题~~

**修复状态**: ✅ 已修复（2026-06-16 之前）

**方案**: `useCallback(..., [])` 在 L138 已有空依赖数组，apply 函数稳定不变。

---

#### 🟡 P2-F2: App.tsx activeRuns 恢复语义不完整

**文件**: `packages/web/src/App.tsx:130-156`

**问题**: ~~刷新时 `handleSessionSelect` 强制清空 `runId`，即使 `activeRunsRef` 有记录也不用~~

**影响**: ~~不符合现代 SPA 习惯，用户体验差~~

**修复状态**: ✅ 已修复（2026-06-17）

**方案**:
- `activeRuns` 持久化到 `sessionStorage`
- 刷新后若当前 `sessionId` 有活跃 `runId`，直接恢复该 `runId` 的 SSE 接管，不再重复 `startContinue`
- 恢复/切回时先乐观挂接本地已知 `runId`，立即进入“连接中 / 接管中”；`GET /api/sessions/:runId` 只做异步探活，若 run 明确失效才清理脏映射并回到“接管/继续”
- 前端每 15 秒对当前 `runId` 与本地 `activeRuns` 中所有 run 去重发送 heartbeat；后端用 heartbeat 租约保护 idle run，不再让“已接管但暂未发任务”的会话在切换后被普通 idle timer 回收
- 切走再切回同一历史会话时：
  - 若旧 run **忙碌**（`executing` / `waiting`）→ 继续自动接管
  - 若旧 run **空闲但仍活着** → 也继续自动接管
  - 只有 run 已结束 / 已失效时，才清理 `activeRuns` 并重新显示“接管/继续”
- 收到 `closed` 事件后同步删除对应 `activeRuns` 记录，避免持久化脏 runId

---

#### 🟡 P2-F3: Conversation.tsx messageRefs 泄漏

**文件**: `packages/web/src/components/Conversation.tsx:365, 827`

**问题**: ~~`messageRefs` 数组只增不减，直接赋值 `messageRefs[index] = el` 不触发状态更新~~

**影响**: ~~切换会话后旧引用未清理，索引错位~~

**修复状态**: ✅ 已修复（2026-06-17）

**方案**: `Conversation.tsx` 已切换到 `react-window` 虚拟列表，移除了旧的 `messageRefs` 数组式 DOM 引用，导航改为通过 `listRef.current?.scrollToRow(...)` 进行命令式滚动。这样历史消息 DOM 不再常驻全量节点，也消除了旧引用累积与索引错位问题。

---

#### 🟡 P2-F4: Conversation.tsx 长对话卡顿

**文件**: `packages/web/src/components/Conversation.tsx:813-979`

**问题**: ~~1000+ 条消息时 DOM 节点过多，滚动卡顿~~

**修复状态**: ✅ 已修复（2026-06-17）

**方案**: 已接入 `react-window` v2：
- `List` 负责历史/实时/pending 混合行的虚拟渲染
- `useDynamicRowHeight` 处理动态高度消息
- `useListRef` 统一滚动定位（顶部/底部/上一条/下一条）

新增测试覆盖 200 条历史消息场景，验证 DOM 中只渲染可视窗口附近节点，而非一次性挂载全部消息。

---

#### 🟡 P2-F5: Composer.tsx 文件上传无并发限制

**文件**: `packages/web/src/components/Composer.tsx:24-37`

**状态澄清**: ⚠️ 文档项已过时。当前实现是 `for...of await uploadFile(file)`，实际为**串行上传**，不存在“同时 100 个并发请求”。

**真实问题**: 串行上传虽然避免了并发打满浏览器，但大量文件时整体耗时长，且失败提示仍不足。

**后续方向**: 若需要优化，应改为“有限并发上传（如 3-4 个）+ 明确的逐文件失败提示”，而不是简单把它当成并发泄漏问题。

---

#### 🟡 P2-F6: Composer.tsx IME 输入误触

**文件**: `packages/web/src/components/Composer.tsx:101-106`

**问题**: 中文输入法 Enter 确认候选词时被错误捕获为"发送"

**修复**: 增加 `e.isComposing` 检查

---

#### 🟡 P2-F7-F14: 其他前端边界条件

- ~~useSession.ts:167 - 重连时清空状态导致界面闪烁~~ ✅ 已修复（2026-06-17）
- ~~useSession.ts:158 - `checkConnection` 延迟检查可能竞态~~ ✅ 已修复（2026-06-17：移除 `readyState` 的 100ms 补丁式探测，仅以 `onopen/onmessage` 作为已连接信号）
- App.tsx:242 - **设计取舍**：当前产品明确采用单一静态 `AUTH_TOKEN`，前端“退出登录”只负责清理本地 `sessionStorage` 与浏览 SSE；若要让后端 token 失效，需引入服务端会话/撤销机制（见长期演进）
- ~~App.tsx / api.ts - token 已失效时界面不会自动退回登录页~~ ✅ 已修复（2026-06-17：浏览类 REST 收到 401 后，前端会自动清理本地 token / activeRuns、关闭浏览 SSE 并退回登录页）
- ~~Conversation.tsx:470 - 文档查询选择器过于宽泛~~ ✅ 已随虚拟滚动重构消除（2026-06-17：消息导航改为 `listRef.scrollToRow()`，不再依赖宽泛 DOM 查询）
- ~~Conversation.tsx:232 - 图片 / 文档 `atob` 解码可能失败~~ ✅ 已修复（2026-06-17：点击附件时 try/catch 兜底；文档 Blob 现按原始字节 `Uint8Array` 构造，避免非 ASCII 二进制内容损坏）
- chatApi.ts:79 - **当前取舍**：`closeSession` 是切换/卸载时的 best-effort 释放，失败静默是有意为之，避免打断主交互；风险主要由后端 idle timeout 与会话自然收尾兜底
- chatApi.ts:84 - **兼容性备注**：`keepalive` 在旧 Safari 上能力有限，但当前产品目标是本机/局域网现代浏览器，不作为当前缺陷处理
- ~~PermissionCard/QuestionCard - `answered` 状态重连后不重置~~ ✅ 已修复（2026-06-17）

---

## 💡 质量改进（21 项）

### 代码重复与可维护性

1. **store.ts:61-93** - `getProjectRealPath` 与 `getSessionCwd` 逻辑重复，应抽取共享函数
2. **Conversation.tsx** - 用户消息气泡样式重复两次（历史+实时），应提取组件
3. ~~**chatRoutes.ts:86-98** - 新建/续聊的 cwd 校验逻辑不对称，应统一为 `validateAndResolveCwd`~~ ✅ 已部分收敛（2026-06-18：新建会话已抽成跨平台 `isSafeAbsoluteCwd()`，同时接受宿主绝对路径与 Windows 绝对路径）
4. **App.tsx:266-520** - 过多内联样式，难以维护，应提取到 CSS 文件

### 类型安全

5. ~~**sdk.ts:42** - `permissionMode` 强转 `as never` 不安全，应在 config 阶段校验枚举~~ ✅ 已修复（2026-06-20：`SdkClient` 改用 SDK `PermissionMode` 类型，并扩展会话级模式校验）
6. **inputQueue.ts:34** - `value: undefined as never` 语义不明，应用显式类型断言
7. ~~**auth.ts:12-15** - 支持 plain token（不带 `Bearer`）降低安全性，应严格要求前缀~~ ✅ 已修复（2026-06-17：仅接受标准 `Authorization: Bearer ...` 头）

### 性能与观测性

8. ~~**useSession.ts:113-120** - `turn_end` 总是追加空消息，界面底部多空白块~~ ✅ 已修复（2026-06-17：`turn_end` 仅清 pending，不再预创建空 assistant 气泡）
9. **useSession.ts:62-74** - `streaming` 累加未清零（除 text 块），可能重复显示
10. ~~**Conversation.tsx** - 大量 `console.log` 未清理（第 408, 420, 687 行）~~ ✅ 已修复（2026-06-17：调试 `console.log` 已移除；保留少量错误日志）
11. ~~**api.ts** - 过多 console.log（6 处），应用日志库或环境变量控制~~ ✅ 已修复（2026-06-17：浏览 SSE 调试日志已移除）

### 错误处理

12. **session.ts:156-196** - `runToCompletion` 异常被吞掉不重新抛出，外部无感知
13. **Composer.tsx:24-37** - 上传失败不提示用户，应捕获错误显示 toast
14. **api.ts:97-100** - SSE 自动重连无指数退避，后端持续 503 时无限重连

### 工程化

15. **api.ts:8** - `API_BASE` 硬编码，应从环境变量读取（`import.meta.env.VITE_API_BASE`）
16. ~~**config.ts** - 未完全校验路径合法性，`claudeProjectsDir` 仍可能是相对路径~~ ✅ 已部分修复（2026-06-17：`CLAUDE_PROJECTS_DIR` 现要求绝对路径）
17. **Composer.tsx:19** - `sending` 状态与 `executing` 重叠冗余
18. **App.tsx:95-96** - `runIdRef.current = runId` 反模式，ref 与 state 同步易出错
19. ~~**App.tsx:100** - `activeRunsRef` 从不清理，会话结束时应从 Map 删除~~ ✅ 已修复（2026-06-17）

### 用户体验

20. **PermissionCard.tsx** - 危险操作（如 `rm -rf`）无二次确认，误触高危
21. **QuestionCard.tsx** - 多选模式下未限制最大选择数，应增加 `maxSelect` 字段

---

## 📐 架构与连接模型问题

### 三层连接架构

```
前端 (EventSource SSE) ↔ 后端 Hub ↔ SessionManager ↔ Agent SDK
```

### 关键发现

1. ~~**刷新无自动重连**: `activeRunsRef` 未持久化，刷新后无法恢复 `runId`，需手动点"接管/继续"，**不符合现代 SPA 习惯**~~ ✅ 已修复
2. ~~**EventSource 生命周期管理不当**: 会话 `closed` 后 SSE 仍连接，浪费资源；`runId` 变 `null` 时不关闭旧连接~~ ✅ 主要泄漏项已修复（`useSession` 清理运行 SSE，`ApiClient.disconnect()` 清理浏览 SSE）
3. ~~**Hub.log 永不截断**: 长会话无限累积事件，内存泄漏风险~~ ✅ 已修复
4. **60秒宽限期可能过短**: 用户在 55 秒时重连可能撞上宽限到期，hub 已删除
5. ~~**无重连次数限制**: 后端永久挂掉时前端无限重连，无指数退避~~ ✅ 已修复

### 体验评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐⭐ (5/5) | 三层分离清晰，Hub 事件重放机制优秀 |
| 生命周期管理 | ⭐⭐⭐⭐☆ (4/5) | 忙碌保活合理，但有竞态窗口 |
| 断线重连 | ⭐⭐⭐⭐☆ (4/5) | 已有指数退避、次数限制与整段重放；仍有少量连接竞态待清理 |
| 资源清理 | ⭐⭐⭐⭐☆ (4/5) | 主要泄漏项已修复，仍有少量长尾边界 |
| 用户体验 | ⭐⭐⭐⭐☆ (4/5) | 已支持刷新自动重连、重连防闪烁与长列表优化 |

**综合评分**: ⭐⭐⭐⚠️☆ (3.5/5)

---

## 🛠️ 修复优先级路线图

### ✅ 第一阶段（已完成）- 安全与泄漏

- [x] P0-1: Token 时序攻击（auth.ts）- 使用 timingSafeEqual
- [x] P0-2: Markdown XSS（Conversation.tsx）- DOMPurify 清理
- [x] P0-3: 实施 CSP 策略 - app.ts 中间件
- [x] P1-1: Hub.log 截断（chatRoutes.ts）- MAX_LOG_EVENTS=10000
- [x] P1-2: EventSource 清理（useSession.ts）- runId 变 null 时关闭
- [x] P1-3: Blob URL 清理（Composer.tsx）- onRemove + useEffect cleanup
- [x] P1-4: api.ts EventSource 清理 - `disconnect()` + logout 主动关闭浏览 SSE

### ✅ 第二阶段（已完成）- 关键边界

- [x] P2-F2: 刷新自动重连（activeRuns 持久化）- sessionStorage
- [x] P2-B4: 负数超时校验（config.ts）- 校验 > 0 && isFinite
- [x] P2-B2: 续聊重置 reportedModel（session.ts）- send() 时重置
- [x] P2-F1: apply 依赖数组修正（useSession.ts）- useCallback([])
- [x] DiffBuilder: 权限确认前 diff 预览 - diffBuilder.ts + PermissionCard
- [x] 重连指数退避 + 次数限制 - useSession.ts MAX_RETRIES=5

### 🔄 第三阶段（进行中）- 体验与性能

- [x] P2-B1: 并发检查加锁（sessionManager.ts）- 插入后检查并回滚
- [x] P2-B2: 续聊重置 reportedModel（session.ts）- send() 时重置（已有）
- [x] P2-B4: 负数超时校验（config.ts）- 校验 > 0 && isFinite（已有）
- [x] P2-B5: 路径穿越检测强化（store.ts）- startsWith 严格前缀检查
- [x] P2-B6: CRLF 兼容性（jsonl.ts）- split(/\r?\n/) 兼容换行符
- [x] P2-B10: 非编码项目目录名保留原样（store.ts）- 避免 `demo-project` 被误解码后隐藏
- [x] P2-B8: inputQueue 并发 next()（inputQueue.ts）- 拒绝旧 waiting
- [x] P2-B12: AUTH_TOKEN 长度校验（config.ts）- 最小 16 字符
- [x] P2-B9: canUseTool 异常兜底（sdk.ts）- 异常时返回 deny
- [x] P2-B11: 配置枚举/并发上限校验（config.ts）- PERMISSION_MODE + MAX_CONCURRENT_SESSIONS
- [x] 💡 CLAUDE_PROJECTS_DIR 绝对路径校验（config.ts）- 拒绝相对路径
- [x] P2-B3: Hub 宽限计时器漏启（chatRoutes.ts）- 始终启动计时器
- [x] P2-B7: query token 范围收紧 + Bearer 强制化（auth.ts）- query token 仅限 SSE/image/stream，普通 REST 只认 Bearer
- [x] P2-F1: apply 依赖数组（useSession.ts）- useCallback([], [])（已有）
- [x] P2-F6: IME 输入误触（Composer.tsx）- isComposing 检查（已有）
- [x] P2-F4: 虚拟滚动（Conversation.tsx）- react-window v2 List + useDynamicRowHeight
- [x] 💡 重连时不清空状态（避免闪烁）- useSession.ts 延迟到首条重放事件再原子重建
- [x] 💡 去除空 assistant 占位气泡 - `turn_end` 不再追加空消息
- [x] 💡 移除 `checkConnection` 竞态补丁 - 连接态只认 `onopen/onmessage`
- [x] 💡 待答卡片状态重置 - PermissionCard / QuestionCard / PlanCard 在 `prompt.id` 变化时重置 answered/submitted
- [x] 💡 activeRuns 恢复语义补全 - 活跃 run 自动接管，失效 run 快速探活后清理；后端后台 agent 列表命中当前会话时也会补写本地映射并直接接管
- [x] 💡 文档附件点击容错 - base64/Blob/window.open 出错时静默失败，不炸界面
- [x] 💡 文档附件二进制字节修正 - base64 解码后按 `Uint8Array` 构造 Blob，避免非 ASCII 附件损坏
- [x] 💡 文档附件 Blob URL 回收 - 新窗口 `load` 后 `revokeObjectURL()`，避免反复点击附件泄漏
- [x] 💡 清理前端调试 console.log - `api.ts` / `Conversation.tsx`
- [ ] 💡 代码重复提取（气泡样式、cwd 校验）
- [ ] 💡 危险操作二次确认

**当前完成度**: 7/7 主要目标（100%）。TECH-DEBT 中仍保留若干长期质量项与少量非阻塞边界项，留待后续迭代。

---

## 📝 测试覆盖补充

当前测试覆盖：35 个测试文件，但以下场景缺失测试：

1. **并发场景**: 两个 `startNew` 同时在 `maxConcurrent` 边界
2. **重连场景**: 网络断开再恢复，事件重放幂等性
3. **泄漏场景**: 切换会话 100 次后内存占用
4. **安全场景**: 时序攻击、XSS、路径穿越
5. **边界值**: 负数超时、超大文件、空文件

**建议**: 补充集成测试 + 端到端测试（Playwright）

---

## 🎯 长期改进方向

### 安全加固

- [ ] 实现 token 过期机制（JWT + 刷新令牌）
- [ ] HttpOnly Cookie 存储 token
- [ ] CSP 策略 + Subresource Integrity
- [ ] 审计日志（谁、何时、做了什么）

### 可观测性

- [ ] 结构化日志（pino）
- [ ] Metrics 指标（活跃会话数、Hub 大小、SSE 连接数）
- [ ] 前端错误监控（Sentry）
- [ ] 性能监控（Web Vitals）

### 用户体验

- [ ] 离线支持（Service Worker）
- [ ] 会话历史导出（JSON/Markdown）
- [ ] 多设备同步（WebSocket 广播）
- [ ] 快捷键支持（Ctrl+K 搜索会话）

### 架构演进

- [ ] 多用户支持（数据库 + 鉴权体系）
- [ ] 分布式部署（Redis 共享 Hub）
- [ ] 搜索索引（Elasticsearch）
- [ ] 历史归档（S3/OSS）

---

## 📚 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目概述与架构
- [docs/superpowers/specs/2026-06-14-cc-web-design.md](./superpowers/specs/2026-06-14-cc-web-design.md) - 历史浏览设计
- [docs/superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md](./superpowers/specs/2026-06-14-cc-web-realtime-conversation-design.md) - 实时续聊设计

---

**审查人**: Claude (Opus 4.6)  
**审查日期**: 2026-06-16  
**审查范围**: 后端 10 个核心模块 + 前端 10 个核心模块  
**方法**: 静态代码分析 + 架构审查 + 用户场景模拟
