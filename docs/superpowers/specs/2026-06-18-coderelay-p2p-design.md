# CodeRelay P2P 接管设计

> 状态：草案，待用户审阅
> 日期：2026-06-18
> 产品名：CodeRelay

## 1. 背景

当前项目已经能通过本机 HTTP 或 ZeroTier 虚拟 IP 访问电脑端服务：

```text
本机浏览器 -> http://localhost:3000
手机/远程设备 -> http://ZeroTier-IP:3000
```

这证明现有应用层能力是成立的：历史会话浏览、实时续聊、后台运行管理、权限确认、计划审批、附件上传、停止当前轮次等能力都已经能通过 HTTP / SSE 工作。

新目标是脱离 ZeroTier，做一套 CodeRelay 自己的远程接管通道。第一版不复刻 ZeroTier 的虚拟网卡和虚拟 IP，而是做 **CodeRelay 专用 P2P 接管**：

```text
手机/远程浏览器
  -> CodeRelay Web
  -> CodeRelay Signal 建连
  -> WebRTC DataChannel 或 Transit 中继
  -> CodeRelay Host
  -> 本机 Claude Code / 会话管理
```

## 2. 目标与非目标

### 目标

- CodeRelay Web 部署到 Vercel，作为手机和远程浏览器入口。
- 自有服务器只承担桥梁职责：`CodeRelay Signal` 做信令，`CodeRelay Transit` 在直连失败时中继加密流量。
- CodeRelay Host 运行在用户电脑上，继续持有会话、历史、Claude Agent SDK、权限确认等核心业务。
- 已配对手机可以通过 WebRTC DataChannel 接管 Host。
- P2P 连接按 Host 复用；切换聊天、订阅不同 run、后台运行管理都走同一条 DataChannel。
- Signal 是控制面；DataChannel 是数据面。DataChannel 建立后，Signal 宕机不影响现有聊天、切换会话、发消息、权限确认和后台运行管理。
- 保留现有 HTTP / ZeroTier 访问方式，P2P 是新增入口，不替换旧入口。

### 非目标

- 不做 ZeroTier / Tailscale 式虚拟网卡。
- 不提供虚拟 IP。
- 不让任意 HTTP 服务通过 CodeRelay P2P 暴露。
- 不做多用户账号系统；第一版仅面向单用户自用。
- 不把 Claude 会话、历史消息、权限确认内容上传到 Signal / Transit。
- 不要求 Signal 在已建连接期间承载业务数据。

## 3. 术语

```text
CodeRelay             整个产品 / GitHub 项目名
CodeRelay Web         部署在 Vercel 的 React/Vite 前端
CodeRelay Host        运行在用户电脑上的本地服务和 P2P Bridge
CodeRelay Signal      WebSocket 信令服务，负责上线、配对、WebRTC 信令交换
CodeRelay Transit     直连失败时的加密流量中继，优先使用 TURN/coturn
HTTPTransport         fetch + EventSource 实现，本地/ZeroTier 模式使用
P2PTransport          WebRTC DataChannel 实现，Vercel 远程模式使用
Peer 连接             Web 与 Host 之间的 WebRTC DataChannel
Signal 连接           Web/Host 与 CodeRelay Signal 之间的 WebSocket 控制连接
```

## 4. 总体架构

第一版包含四个运行角色：

```text
CodeRelay Web
  - Vercel 托管
  - 手机/远程浏览器打开
  - 负责 UI、配对、连接、会话操作

CodeRelay Host
  - 用户电脑本地运行
  - 持有 Host 私钥和受信任 Client 列表
  - 继续提供本地 HTTP API
  - 通过本机 CodeRelay Web HTTP 模式提供设备管理入口
  - 新增 P2P Bridge，接收 DataChannel 请求并转给本机业务层

CodeRelay Signal
  - 自有服务器运行
  - 负责 Host 上线、Client 请求连接、配对消息转发、offer/answer/candidate 交换
  - 不处理业务 API

CodeRelay Transit
  - 自有服务器或标准 TURN 服务
  - 直连失败时转发加密流量
  - 不解密业务内容
```

理想数据路径：

```text
CodeRelay Web <==== WebRTC DataChannel ====> CodeRelay Host
```

兜底路径：

```text
CodeRelay Web <==== TURN/Transit 加密中继 ====> CodeRelay Host
```

Signal 只参与建连、配对和重连：

```text
CodeRelay Web <---- WebSocket ----> CodeRelay Signal <---- WebSocket ----> CodeRelay Host
```

Host 不要求第一版提供 Electron 或原生桌面窗口。电脑端管理操作复用本机 HTTP 入口：用户在电脑上打开 `http://localhost:3000` 的 CodeRelay Web HTTP 模式页面，在“设备管理”中添加、确认或撤销手机设备。CLI 可以作为兜底入口，但不是主体验。

## 5. 入口与传输模式选择

CodeRelay Web 支持两种传输模式：

```text
HTTP 模式
  - localhost / ZeroTier / 局域网直连
  - 使用 fetch + EventSource

P2P 模式
  - Vercel 入口
  - 使用 WebRTC DataChannel
```

浏览器按入口选择默认模式：

- 本地开发和 Host 本机页面默认 `HTTPTransport`。
- Vercel 部署默认 `P2PTransport`。
- URL 参数可以覆盖模式，用于调试：

```text
?transport=http
?transport=p2p
```

Signal 地址来源：

- `apps/web` 通过构建环境变量注入默认 Signal 地址：

```text
VITE_SIGNAL_URL=wss://signal.example.com
```

- URL 参数允许覆盖：

```text
?signal=wss://dev-signal.example.com
```

- `apps/host` 通过本地配置、环境变量或启动参数获取 Signal 地址：

```text
CODERELAY_SIGNAL_URL=wss://signal.example.com
~/.coderelay/config.json
coderelay-host --signal wss://signal.example.com
```

- 配对二维码必须携带 `signalUrl`，确保手机和 Host 使用同一个 Signal。

## 6. Transport 抽象

现有前端直接依赖：

```text
fetch("/api/...")
EventSource("/api/.../stream")
```

P2P 模式下，Vercel 页面无法直接访问 Host 的 `/api`，因此需要抽象：

```typescript
interface CodeRelayTransport {
  request<TRequest, TResponse>(
    request: TransportRequest<TRequest>
  ): Promise<TResponse>;

  subscribe<TEvent>(
    request: TransportSubscribeRequest
  ): TransportStream<TEvent>;
}
```

实现：

```text
HTTPTransport
  - request -> fetch
  - subscribe -> EventSource

P2PTransport
  - request -> DataChannel request/response envelope
  - subscribe -> DataChannel stream envelope
```

REST 语义保留，只改变承载方式。P2P 请求示例：

```json
{
  "type": "request",
  "id": "req_123",
  "method": "GET",
  "path": "/api/projects",
  "body": null
}
```

P2P 流订阅示例：

```json
{
  "type": "stream_open",
  "streamId": "stream_1",
  "path": "/api/sessions/run-1/stream"
}
```

Host 回推事件：

```json
{
  "type": "stream_event",
  "streamId": "stream_1",
  "event": {
    "type": "status",
    "state": "executing"
  }
}
```

第一版 Host 侧处理方式：

```text
P2P request -> Host 本机 HTTP API -> 现有 Express routes -> response
P2P stream  -> Host 本机 SSE -> DataChannel stream_event
```

这样可以最大化复用现有业务逻辑。后续若需要减少本机 HTTP/SSE 绕行，再把 Express route 背后的逻辑拆成 service 直接调用。

## 7. P2P 连接复用与会话切换

P2P 连接是 Host 级长连接，不是 session/run 级连接。

```text
一条 DataChannel
  - listProjects
  - getSession
  - startContinue
  - subscribe run A
  - unsubscribe run A
  - subscribe run B
  - sendMessage run B
  - respondPrompt run B
```

切换聊天不重建 WebRTC，不重新打洞，不重新经过 Signal。它只是在同一条 DataChannel 上关闭旧逻辑 stream、打开新逻辑 stream。

只有这些场景需要重建 Peer 连接：

- 首次连接 Host。
- WebRTC DataChannel 断开。
- Host 重启。
- 手机网络切换导致 ICE 不可恢复。
- 用户主动断开设备连接。
- 设备被撤销或安全状态变化。

Signal 与 Peer 状态分开展示：

```text
peerStatus: connecting | connected | disconnected
signalStatus: connected | disconnected
```

当 `signalStatus=disconnected` 但 `peerStatus=connected` 时，业务仍可继续；UI 只提示：

```text
Signal 失联，当前连接仍可用，断线后可能无法自动重连。
```

## 8. 设备身份与配对

第一版为单用户自用，不做账号系统。信任关系放在设备本地。

每台设备生成长期身份：

```text
Host:
  hostId
  hostPublicKey
  hostPrivateKey

Client/Web:
  clientId
  clientPublicKey
  clientPrivateKey
```

首次配对流程：

```text
1. 用户在电脑本机打开 CodeRelay Host 的本地 Web UI，点击“添加设备”
2. Host 生成一次性 pairingId + pairingSecret
3. Host 显示二维码
4. 手机扫码打开 CodeRelay Web
5. 手机生成 client keypair
6. 手机通过 Signal 发送 clientPublicKey 和配对证明
7. Host 显示新设备请求
8. 用户在 Host 端确认
9. Host 保存 clientPublicKey 到 trustedClients
10. 手机保存 hostPublicKey 到 trustedHosts
```

二维码包含：

```text
webUrl
signalUrl
hostId
hostPublicKey 或 hostPublicKey fingerprint
pairingId
pairingSecret
expiresAt
```

二维码不包含任何私钥。`pairingSecret` 短时有效，建议 2 到 5 分钟。

后续连接流程：

```text
1. Client 请求连接 hostId
2. Signal 转发请求给 Host
3. Host 检查 clientId / clientPublicKey 是否在 trustedClients
4. 双方互发 challenge
5. 双方用私钥签名 challenge
6. 双方验证对方公钥签名
7. 验证通过后才进入 WebRTC 信令交换
```

设备存储：

```text
Host 本地:
  - host private key
  - host public key
  - trusted clients

Phone / Browser IndexedDB:
  - client private key 或不可导出 CryptoKey
  - client public key
  - trusted hosts
```

多个手机设备对应多个 `trustedClients` 条目。丢失某台手机时，Host 只撤销该手机的公钥，不影响其他设备。

第一版密钥实现可以优先做兼容性验证：

- 浏览器侧可评估 WebCrypto `ECDSA P-256`。
- 若使用 Ed25519，可评估 `@noble/ed25519`。
- 私钥长期目标是使用不可导出 WebCrypto Key；第一版若使用 IndexedDB 存导出密钥材料，必须在风险说明里标明 XSS 风险，并保留升级路径。

## 9. Signal 与 Transit 职责边界

CodeRelay Signal 负责低带宽控制消息：

- Host 上线/下线。
- Client 请求连接 Host。
- 配对消息转发。
- WebRTC offer / answer / ICE candidate 转发。
- 连接状态通知。
- 限流和基础防滥用。

Signal 不负责：

- 不读取 Claude 会话。
- 不保存聊天历史。
- 不代理业务 REST API 明文。
- 不最终决定某台 Client 是否可接管 Host。

最终授权由 Host 本地 `trustedClients` 决定。

CodeRelay Transit 负责直连失败时的加密流量中继。第一版优先采用标准 TURN/coturn：

```text
apps/signal 下发 TURN 配置
WebRTC ICE 自动选择直连或 TURN
```

Signal/Transit 可以看到在线状态、连接时长、流量大小和 IP，但不应该看到项目列表、聊天内容、工具调用参数、文件内容或权限确认内容。

## 10. Monorepo 结构

项目结构一步到位迁移为 CodeRelay 角色结构：

```text
apps/
  web/
  host/
  signal/

packages/
  shared/
  transport/
  p2p-core/
  test-utils/
```

迁移关系：

```text
packages/web     -> apps/web
packages/server  -> apps/host
packages/shared  -> packages/shared
```

包名：

```text
@coderelay/web
@coderelay/host
@coderelay/signal
@coderelay/shared
@coderelay/transport
@coderelay/p2p-core
@coderelay/test-utils
```

职责：

- `apps/web`: CodeRelay Web，React/Vite 前端，支持 HTTP 和 P2P 两种 transport。
- `apps/host`: CodeRelay Host，现有本机 HTTP 服务、Claude Agent SDK、SessionManager，以及后续 P2P Bridge。
- `apps/signal`: CodeRelay Signal，WebSocket 信令和配对服务。
- `packages/shared`: 业务共享类型，包括项目、会话、消息、`ServerEvent`、`PendingPrompt`、`ActiveAgent`。
- `packages/transport`: `CodeRelayTransport`、`HTTPTransport`、P2P envelope、stream 抽象。
- `packages/p2p-core`: 设备身份、配对协议、信令消息、challenge/签名类型、trusted device 数据结构。
- `packages/test-utils`: 跨包复用测试工具。单元测试仍与源码同目录。

测试不统一抽到 `tests/` 目录。规则：

```text
单元/组件测试继续和源码同目录
跨包 fake/mock/helper 放 packages/test-utils
未来完整浏览器端到端测试可再评估 apps/e2e
```

## 11. 可复用现有能力

可复用：

- `packages/shared` 中的业务契约。
- 现有 server 里的历史读取、JSONL 解析、搜索、标题提取。
- `SessionManager`、`Session`、`SdkClient`、后台运行、heartbeat、并发上限。
- 现有续聊路由语义：新建、续聊、发消息、回答待办、停止当前轮次、关闭后台运行、事件流重放。
- Web 侧大部分 UI：Sidebar、Conversation、Composer、QuestionCard、PermissionCard、PlanCard。
- `useSession` 中的 `ServerEvent` 归约逻辑可保留，但订阅来源应改为 transport。

需要新增：

- CodeRelay Signal。
- TURN/Transit 配置。
- Host P2P Bridge。
- transport 抽象和 P2P envelope。
- 设备身份、二维码配对、trusted devices、撤销设备。
- WebRTC DataChannel 连接状态机。

## 12. 实现阶段

### 阶段 1：CodeRelay 结构迁移

只改结构和命名，不改变现有行为。

验收：

```text
npm install
npm run build
npm test
npm run dev:web
npm run dev:host
```

现有 HTTP / ZeroTier 访问继续可用。

### 阶段 2：Transport 抽象

把现有 `fetch` / `EventSource` 收敛到统一 transport。先实现 `HTTPTransport`，`P2PTransport` 只定义接口和消息 envelope。

测试：

- `request` 成功和错误处理。
- `subscribe` 收到事件、关闭订阅、错误处理。
- UI 通过 `HTTPTransport` 行为保持不变。

### 阶段 3：设备身份与配对协议

在 `packages/p2p-core` 实现协议和本地数据结构。

测试：

- 二维码 payload 不包含私钥。
- pairing 过期后失效。
- 未信任 Client 不能连接。
- 已撤销 Client 不能连接。
- 多个手机设备可独立保存和撤销。
- challenge 签名验证失败时拒绝连接。

### 阶段 4：CodeRelay Signal

实现 WebSocket 信令服务。

测试：

- Host 上线、下线。
- Client 请求连接在线 Host。
- Host 离线时连接请求失败。
- pairingId 过期或不存在时失败。
- offer/answer/candidate 只在目标连接间转发。
- Signal 不处理业务 API。

### 阶段 5：WebRTC DataChannel 建连

Web 和 Host 建立 Host 级长连接。

测试：

- 建连成功后 request/response 能往返。
- Signal 断开但 DataChannel 未断时，业务请求仍可用。
- DataChannel 断开后进入不可用状态。
- Signal 恢复后可以重新建连。
- Peer 状态和 Signal 状态分开展示。

### 阶段 6：P2PTransport 接入业务

让 Vercel 的 CodeRelay Web 通过 P2PTransport 使用现有业务能力。

覆盖：

- 项目列表。
- 会话列表和会话详情。
- 新建会话。
- 续聊。
- 发送消息。
- 回答 question / permission / plan。
- 停止当前轮次。
- 关闭后台运行。
- 订阅 session stream。

测试：

- P2P request 与 HTTP request 行为等价。
- P2P stream 与 SSE stream 行为等价。
- 切换会话复用同一 DataChannel。
- 后台运行列表、权限确认、计划审批都能走 P2P。

### 阶段 7：Transit / TURN 兜底

接入标准 TURN/coturn。

测试：

- 无 TURN 且直连失败时给出明确错误。
- 有 TURN 时可通过中继建立 DataChannel。
- UI 能显示当前连接是直连或中继。

## 13. 安全要求

- Host 端确认首次配对。
- 私钥只保存在本设备。
- Signal/Transit 不能成为业务信任根。
- Host 根据本地 trustedClients 做最终授权。
- 每台手机独立身份，可单独撤销。
- 已撤销设备不能继续新建连接。
- DataChannel 建立后仍保留现有工具调用、文件修改、计划审批等权限确认。
- `PERMISSION_MODE` 非 default 时应在远程入口明显提示风险。
- 前端托管在 Vercel 意味着 Vercel 页面 JavaScript 属于信任边界；后续可增加 PWA 固化、前端版本指纹和 Host 端确认。
- 手机浏览器 IndexedDB 丢失时，需要重新配对。

## 14. 风险与早期验证

### Node WebRTC 选型风险

Host 是 Node 进程，浏览器 WebRTC 要连接 Node。需要早期验证：

- `werift`: 纯 TypeScript，集成简单，但需验证稳定性和兼容性。
- `node-datachannel`: 性能好，但原生依赖和安装复杂度更高。

阶段 5 前必须完成最小 spike：浏览器与 Host Node 建立 DataChannel，完成一次 request/response。

### 重构风险

结构和包名一步到位会影响 workspace、tsconfig、测试配置、脚本和 import 路径。阶段 1 必须只做结构迁移，不夹带行为变化。

### 安全风险

CodeRelay 远程接管 Host 后，等价于给本机 Claude Code 增加公网可达入口。设备身份、配对确认、权限确认和撤销能力必须先于 P2P 业务入口落地。

### 可用性风险

WebRTC 直连受 NAT、防火墙、运营商网络影响。第一版允许 Transit/TURN 中继以提高成功率。

## 15. 第一版验收标准

- Monorepo 改为 CodeRelay 结构和包名。
- 现有 HTTP 模式功能保持可用。
- Web 通过 transport 抽象访问业务，不再散落直接依赖 `fetch` / `EventSource`。
- Host/Web 能完成二维码配对。
- Host 支持保存多个受信任手机设备。
- Web 和 Host 通过 Signal 建立 WebRTC DataChannel。
- Signal 断开但 DataChannel 仍在线时，聊天和切换会话继续可用。
- P2PTransport 能完成项目列表、会话浏览、接管、发消息、权限确认、后台运行管理。
- P2P 连接按 Host 复用，切换聊天不重建 P2P。
- 直连失败时允许通过 Transit/TURN 中继加密流量。
- 全部开发遵循仓库强制 TDD：先写失败测试，再实现，再重构。
