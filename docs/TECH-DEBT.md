# 技术债务与改进规划

> 本文档记录 cc-web 项目经深度代码审查后发现的已知问题、技术债务和改进方向。
> 
> 最后更新：2026-06-16
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

**问题**: `ApiClient` 析构时 `this.eventSource` 仍存在，登出后旧连接仍尝试重连

**影响**: 内存泄漏 + 无效网络请求

**修复**:
```typescript
// ApiClient 类增加析构方法
disconnect(): void {
  this.eventSource?.close();
  this.eventSource = null;
}

// App.tsx 登出时调用
const handleLogout = () => {
  closePrevious();
  apiClient?.disconnect();
  setApiClient(null);
  // ...
};
```

---

## 🎯 P2 - 边界条件缺陷（29 项）

### 后端（15 项）

#### 🟡 P2-B1: sessionManager 并发检查非原子

**文件**: `packages/server/src/sessionManager.ts:37-40`

**问题**: 检查 `size >= maxConcurrent` 与插入 entry 之间非原子，两个 `startNew` 可能同时通过检查

**影响**: 可能超出并发上限

**建议**: 插入后再检查并回滚，或用标志位加锁

---

#### 🟡 P2-B2: session.ts 续聊不重置 reportedModel

**文件**: `packages/server/src/session.ts:222-225`

**问题**: 续聊第二轮用不同模型时，`reportedModel` 仍为第一轮的值，新模型不上报

**影响**: 前端 UI 显示旧模型名

**修复**: 每次 `send()` 时重置 `this.reportedModel = null`

---

#### 🟡 P2-B3: chatRoutes Hub 宽限计时器漏启

**文件**: `packages/server/src/chatRoutes.ts:70-75`

**问题**: 若会话结束时正好有 SSE 连接，不启动宽限计时器；若后续连接断开但未触发 `onClose`（网络闪断），hub 永久驻留

**建议**: 无论是否有连接都预约清理，有连接时由 `onClose` 取消并重启

---

#### 🟡 P2-B4: config.ts 负数超时

**文件**: `packages/server/src/config.ts:26-31`

**问题**: `SESSION_IDLE_TIMEOUT_MS=-1000` 会导致 `setTimeout` 立即触发，会话秒杀

**修复**: 校验 `> 0 && isFinite(idleTimeoutMs)`

---

#### 🟡 P2-B5: store.ts 路径穿越检测

**文件**: `packages/server/src/store.ts:189-192`

**问题**: Windows 下 `path.isAbsolute(rel)` 可能误判

**建议**: 改用 `target.startsWith(root + path.sep)` 更严格

---

#### 🟡 P2-B6: jsonl.ts CRLF 兼容性

**文件**: `packages/server/src/jsonl.ts:26`

**问题**: `split('\n')` 在 Windows CRLF 下每行残留 `\r`

**修复**: `split(/\r?\n/)` 兼容两种换行符

---

#### 🟡 P2-B7: auth.ts query token 泄漏

**文件**: `packages/server/src/auth.ts:6`

**问题**: `?token=xxx` 明文出现在 URL，Web 服务器日志会记录

**建议**: 文档中警告 "query token 仅限开发环境"，生产环境强制 header

---

#### 🟡 P2-B8-B15: 其他后端边界条件

- inputQueue.ts:47 - 并发调用 `next()` 覆盖 `waiting` promise
- pending.ts:30 - `settle` 同步执行可能阻塞响应
- sdk.ts:44 - `canUseTool` 未捕获异常
- store.ts:38 - 项目目录不存在时跳过（应标记离线）
- store.ts:216 - UNC/Unix 路径无法解码
- config.ts:18 - `parseInt` 失败静默降级
- config.ts:35 - `AUTH_TOKEN` 未校验长度（应 >=16）
- sessionManager.ts:56 - 实例相等校验有纳秒级竞态窗口

---

### 前端（14 项）

#### 🟡 P2-F1: useSession.ts apply 无依赖数组

**文件**: `packages/web/src/useSession.ts:53`

**问题**: `apply` 使用 `useCallback` 但无依赖数组，每次重渲染触发 SSE 重连

**影响**: 频繁断开重连，性能问题

**修复**: `useCallback(..., [])`

---

#### 🟡 P2-F2: App.tsx 刷新无自动重连

**文件**: `packages/web/src/App.tsx:130-156`

**问题**: 刷新时 `handleSessionSelect` 强制清空 `runId`，即使 `activeRunsRef` 有记录也不用

**影响**: 不符合现代 SPA 习惯，用户体验差

**建议方案**:
```typescript
// 持久化 activeRuns 到 sessionStorage
useEffect(() => {
  sessionStorage.setItem('ccweb_activeRuns', 
    JSON.stringify([...activeRunsRef.current]));
}, [runId]);

// 刷新后恢复
useEffect(() => {
  const saved = sessionStorage.getItem('ccweb_activeRuns');
  if (saved) {
    const map = new Map(JSON.parse(saved));
    activeRunsRef.current = map;
    const params = new URLSearchParams(location.search);
    const sid = params.get('session');
    if (sid && map.has(sid)) {
      setRunId(map.get(sid)!); // 自动恢复
    }
  }
}, []);
```

---

#### 🟡 P2-F3: Conversation.tsx messageRefs 泄漏

**文件**: `packages/web/src/components/Conversation.tsx:365, 827`

**问题**: `messageRefs` 数组只增不减，直接赋值 `messageRefs[index] = el` 不触发状态更新

**影响**: 切换会话后旧引用未清理，索引错位

**建议**: 用 `useRef<Map<number, HTMLDivElement>>(new Map())` 或在会话切换时清理

---

#### 🟡 P2-F4: Conversation.tsx 长对话卡顿

**文件**: `packages/web/src/components/Conversation.tsx:813-979`

**问题**: 1000+ 条消息时 DOM 节点过多，滚动卡顿

**建议**: 引入虚拟列表（react-window）

---

#### 🟡 P2-F5: Composer.tsx 文件上传无并发限制

**文件**: `packages/web/src/components/Composer.tsx:24-37`

**问题**: 选择 100 个文件时并发 100 个请求，可能超浏览器限制

**建议**: 分批上传（每批 4 个）

---

#### 🟡 P2-F6: Composer.tsx IME 输入误触

**文件**: `packages/web/src/components/Composer.tsx:101-106`

**问题**: 中文输入法 Enter 确认候选词时被错误捕获为"发送"

**修复**: 增加 `e.isComposing` 检查

---

#### 🟡 P2-F7-F14: 其他前端边界条件

- useSession.ts:167 - 重连时清空状态导致界面闪烁
- useSession.ts:158 - `checkConnection` 延迟检查可能竞态
- App.tsx:242 - 前端登出不使后端 token 失效
- Conversation.tsx:470 - 文档查询选择器过于宽泛
- Conversation.tsx:232 - 图片 `atob` 解码可能失败
- chatApi.ts:79 - `closeSession` 失败静默可能泄漏会话
- chatApi.ts:84 - `keepalive` 在 Safari <14 不可靠
- PermissionCard/QuestionCard - `answered` 状态重连后不重置

---

## 💡 质量改进（21 项）

### 代码重复与可维护性

1. **store.ts:61-93** - `getProjectRealPath` 与 `getSessionCwd` 逻辑重复，应抽取共享函数
2. **Conversation.tsx** - 用户消息气泡样式重复两次（历史+实时），应提取组件
3. **chatRoutes.ts:86-98** - 新建/续聊的 cwd 校验逻辑不对称，应统一为 `validateAndResolveCwd`
4. **App.tsx:266-520** - 过多内联样式，难以维护，应提取到 CSS 文件

### 类型安全

5. **sdk.ts:42** - `permissionMode` 强转 `as never` 不安全，应在 config 阶段校验枚举
6. **inputQueue.ts:34** - `value: undefined as never` 语义不明，应用显式类型断言
7. **auth.ts:12-15** - 支持 plain token（不带 `Bearer`）降低安全性，应严格要求前缀

### 性能与观测性

8. **useSession.ts:113-120** - `turn_end` 总是追加空消息，界面底部多空白块
9. **useSession.ts:62-74** - `streaming` 累加未清零（除 text 块），可能重复显示
10. **Conversation.tsx** - 大量 `console.log` 未清理（第 408, 420, 687 行）
11. **api.ts** - 过多 console.log（6 处），应用日志库或环境变量控制

### 错误处理

12. **session.ts:156-196** - `runToCompletion` 异常被吞掉不重新抛出，外部无感知
13. **Composer.tsx:24-37** - 上传失败不提示用户，应捕获错误显示 toast
14. **api.ts:97-100** - SSE 自动重连无指数退避，后端持续 503 时无限重连

### 工程化

15. **api.ts:8** - `API_BASE` 硬编码，应从环境变量读取（`import.meta.env.VITE_API_BASE`）
16. **config.ts** - 未校验路径合法性，`claudeProjectsDir` 可能是相对路径
17. **Composer.tsx:19** - `sending` 状态与 `executing` 重叠冗余
18. **App.tsx:95-96** - `runIdRef.current = runId` 反模式，ref 与 state 同步易出错
19. **App.tsx:100** - `activeRunsRef` 从不清理，会话结束时应从 Map 删除

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

1. **刷新无自动重连**: `activeRunsRef` 未持久化，刷新后无法恢复 `runId`，需手动点"在此继续"，**不符合现代 SPA 习惯**
2. **EventSource 生命周期管理不当**: 会话 `closed` 后 SSE 仍连接，浪费资源；`runId` 变 `null` 时不关闭旧连接
3. **Hub.log 永不截断**: 长会话无限累积事件，内存泄漏风险
4. **60秒宽限期可能过短**: 用户在 55 秒时重连可能撞上宽限到期，hub 已删除
5. **无重连次数限制**: 后端永久挂掉时前端无限重连，无指数退避

### 体验评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐⭐ (5/5) | 三层分离清晰，Hub 事件重放机制优秀 |
| 生命周期管理 | ⭐⭐⭐⭐☆ (4/5) | 忙碌保活合理，但有竞态窗口 |
| 断线重连 | ⭐⭐⭐⭐☆ (4/5) | 重放机制完备，但无指数退避 |
| 资源清理 | ⭐⭐☆☆☆ (2/5) | SSE 泄漏、Hub.log 无界增长 |
| 用户体验 | ⭐⭐⚠️☆☆ (2.5/5) | 刷新无自动重连，不符合习惯 |

**综合评分**: ⭐⭐⭐⚠️☆ (3.5/5)

---

## 🛠️ 修复优先级路线图

### 第一阶段（本周）- 安全与泄漏

- [ ] P0-1: Token 时序攻击（auth.ts）
- [ ] P0-2: Markdown XSS（Conversation.tsx）
- [ ] P0-3: 实施 CSP 策略
- [ ] P1-1: Hub.log 截断（chatRoutes.ts）
- [ ] P1-2: EventSource 清理（useSession.ts）
- [ ] P1-3: Blob URL 清理（Composer.tsx）
- [ ] P1-4: api.ts EventSource 清理

### 第二阶段（下周）- 关键边界

- [ ] P2-F2: 刷新自动重连（activeRuns 持久化）
- [ ] P2-B4: 负数超时校验（config.ts）
- [ ] P2-B2: 续聊重置 reportedModel（session.ts）
- [ ] P2-F1: apply 依赖数组修正（useSession.ts）
- [ ] P2-B1: 并发检查加锁（sessionManager.ts）

### 第三阶段（迭代优化）- 体验与性能

- [ ] P2-F4: 虚拟滚动（Conversation.tsx）
- [ ] 💡 重连指数退避 + 次数限制
- [ ] 💡 重连时不清空状态（避免闪烁）
- [ ] 💡 代码重复提取（气泡样式、cwd 校验）
- [ ] 💡 清理 console.log
- [ ] 💡 危险操作二次确认

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
