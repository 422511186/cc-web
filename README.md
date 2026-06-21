# CodeRelay

CodeRelay 把本地 Claude Code 会话搬到 Web 和手机端使用：可以浏览历史会话，也可以从浏览器接管同一个活跃会话继续聊天、处理权限确认、批准 plan、切换 Claude Code 模式，并通过 HTTP 或 P2P 两种传输访问 Host。

当前项目定位是本地优先的个人工具。Host 跑在拥有 Claude Code 环境的电脑上，Web 可以跑在同一台机器、局域网、ZeroTier 网络或独立前端服务器上；P2P 模式通过 Signal 服务完成配对和 WebRTC 信令，业务数据走 WebRTC DataChannel。

## 功能概览

- 浏览 Claude Code 历史项目、会话和消息。
- 远程接管活跃会话，继续向同一个 Claude Code session 发送消息。
- 支持流式回复、后台运行、停止当前回合、切换会话后重新接管。
- 支持 AskUserQuestion、工具权限确认、ExitPlanMode 计划审批。
- 支持 Claude Code 模式切换：`auto`、`plan`、`acceptEdits`、`bypassPermissions` 等。
- 支持图片上传，实时消息和历史记录都会显示图片缩略图。
- 支持 HTTP 直连与 P2P DataChannel 两种传输。
- Host 管理页支持设备配对、二维码、授权设备管理和 P2P 状态查看；多个已授权设备可同时在线，互不挤下线。

## 项目结构

```text
apps/
  host/      CodeRelay Host，Express + Claude Agent SDK
  web/       CodeRelay Web，React + Vite
  signal/    CodeRelay Signal，轻量 WebSocket 信令服务
packages/
  shared/    前后端共享 API、事件和领域类型
  transport/ HTTPTransport / P2PTransport / WebRTC DataChannel
  p2p-core/  P2P 身份、配对、加密辅助逻辑
  test-utils/测试辅助包
docs/        设计文档、技术债务和规格说明
```

## 架构简图

```text
HTTP 模式:

Browser Web  ── HTTP/SSE ──> CodeRelay Host ── Claude Agent SDK ── Claude Code

P2P 模式:

Browser Web  ── WebSocket ─┐
                           ├── CodeRelay Signal  只负责配对和信令
CodeRelay Host ─ WebSocket ┘

Browser Web  ══ WebRTC DataChannel ══ CodeRelay Host ── Claude Agent SDK
```

Signal 只负责上线、配对、offer/answer/ICE 信令交换。P2P 建立成功后，聊天、会话列表、图片读取等业务请求走 DataChannel；已建立的 P2P 连接不依赖 Signal 持续在线。

## 环境要求

- Node.js 22+（当前本地使用 Node 24 也可）。
- npm workspaces。
- 已安装并能正常运行 Claude Code。
- Host 机器上存在 Claude 历史目录，默认是 `~/.claude/projects`。
- 如果要手机访问，手机需要能访问 Web 页面；HTTP 模式还需要能访问 Host API，P2P 模式需要能访问 Signal。

## 安装

```bash
npm install
```

## 快速启动：HTTP / ZeroTier 模式

适合电脑和手机已经在同一个局域网或 ZeroTier 网络里，手机可以直接访问电脑 IP 的情况。

Windows 可以直接开两个终端：

```bat
start-host.bat
start-web.bat
```

> 说明：`start-host.bat` 是「本地全功能」启动脚本，为了方便本地试 P2P，它默认也会设置 `P2P_SIGNAL_URL=ws://127.0.0.1:8787/`。如果你只用 HTTP / ZeroTier、没有启动 Signal，Host 会在后台尝试连接这个并不存在的 Signal 并失败重试——**这不影响 HTTP 续聊**，相关日志可以忽略。若想完全关掉 P2P，启动前设 `set P2P_SIGNAL_URL=` 清空即可。

默认地址：

- Web: `http://127.0.0.1:3000`
- Host API: `http://127.0.0.1:3002`
- Host 管理页: `http://127.0.0.1:3002/host`
- 开发 token: `test-token-123456`

如果手机通过 ZeroTier、Tailscale 或局域网访问电脑，把 `127.0.0.1` 换成电脑在该网络里的地址，例如：

```text
http://<host-ip>:3000
http://<host-ip>:3002/host
```

## 快速启动：P2P 模式

P2P 模式需要三部分：

1. CodeRelay Signal：中间信令服务。
2. CodeRelay Host：本机 Claude Code 接管服务。
3. CodeRelay Web：浏览器/手机页面。

本地开发可以开三个终端：

```powershell
$env:PORT="8787"
npm run dev:signal
```

```powershell
$env:AUTH_TOKEN="test-token-123456"
$env:PORT="3002"
$env:P2P_SIGNAL_URL="ws://127.0.0.1:8787/"
$env:P2P_WEB_URL="http://127.0.0.1:3000"
$env:P2P_HOST_ID="coderelay-local-host"
$env:P2P_ICE_LOCAL_ADDRESS="127.0.0.1"
npm run dev:host
```

```powershell
$env:VITE_CODERELAY_SIGNAL_URL="ws://127.0.0.1:8787/"
npm run dev:web
```

手机验证时通常把这些地址换成局域网或 ZeroTier IP：

```powershell
$env:P2P_SIGNAL_URL="ws://<host-ip>:8787/"
$env:P2P_WEB_URL="http://<host-ip>:3000"
$env:P2P_ICE_LOCAL_ADDRESS="<host-ip>"
$env:VITE_CODERELAY_SIGNAL_URL="ws://<host-ip>:8787/"
```

配对流程：

1. 打开 Host 管理页：`http://<host-ip>:3002/host`。
2. 点击添加设备，生成二维码。
3. 手机扫描二维码打开 Web。
4. 首次配对成功后，手机会保存 Host 公钥和信任信息。
5. 后续打开 Web 可尝试使用已保存的信任信息重新连接，不必每次扫码。

## 部署文档

部署前先分清三个组件：

- Host：必须运行在真正拥有 Claude Code 环境的电脑、工作站或远程开发机上。
- Web：浏览器页面，可以部署到 Vercel、静态服务器、VPS 或本机。
- Signal：P2P 信令服务，可以部署到 VPS、云服务器或本机。

部署说明在 [docs/deployment](./docs/deployment/README.md)。按场景选择：

- [HTTP / ZeroTier 部署](./docs/deployment/http-zerotier.md)：手机能直接访问电脑 IP 时使用，最简单，不需要 Signal。
- [P2P: Vercel Web + VPS Signal](./docs/deployment/p2p-vercel-signal-vps.md)：Web 放 Vercel，Signal 放 VPS，Host 不暴露公网。
- [P2P: VPS 静态 Web + VPS Signal](./docs/deployment/p2p-static-vps.md)：不使用 Vercel，Web 静态站和 Signal 都放自己的服务器。

组件细节：

- [Host 运行与配置](./docs/deployment/host-runtime.md)
- [Signal 运行与配置](./docs/deployment/signal-runtime.md)
- [Web 构建与托管](./docs/deployment/web-runtime.md)
- [上线检查清单](./docs/deployment/production-checklist.md)

变量生效时机的快速结论（这是最容易配错的地方）：

- **Web 前端的 `VITE_*` 是「构建时」变量**：执行 `npm run build` 时被写死进 `apps/web/dist` 的 JS 包里。部署后只改服务器上的环境变量**不会生效**，必须重新构建并重新部署 Web。
- **Host / Signal 的环境变量是「运行时」变量**：进程启动时读取。改完只需**重启进程**即可生效，不需要重新 `npm run build`（build 只是为了更新代码本身）。
- Web 开发模式的 `CODERELAY_DEV_API_TARGET`：启动 `npm run dev:web` 时读取，只影响本地代理，改完后重启开发服务器。

P2P 的 Signal 地址有两层来源：

| 谁要连 Signal | 用哪个变量 | 注入时机 | 改了之后怎么生效 |
| --- | --- | --- | --- |
| Host | `P2P_SIGNAL_URL`（或 `CODERELAY_SIGNAL_URL`） | 运行时，启动 Host 前设置 | 重启 Host 进程 |
| Web 默认值 | `VITE_CODERELAY_SIGNAL_URL` | 构建时，`npm run build` 时写入前端包 | 重新构建 + 重新部署 Web |
| Web 扫码配对 | 二维码短链里的 `#signal=...` | Host 生成二维码时写入 | 更新 Host 的 `P2P_SIGNAL_URL` 后重启或在管理页保存设置，再重新生成二维码 |

扫码配对时，Web 会优先使用二维码 hash 中的 Signal 地址；`VITE_CODERELAY_SIGNAL_URL` 只是没有扫码上下文时的默认值。hash 不会被浏览器发送给 Vercel/CDN。详见 [部署文档](./docs/deployment/README.md)。

## 常用命令

```bash
# 构建所有 workspace
npm run build

# 跑全部测试
npm test

# 覆盖率测试
npm run test:coverage

# 单独启动服务
npm run dev:host
npm run dev:web
npm run dev:signal

# 单 workspace 测试
npm test --workspace @coderelay/host
npm test --workspace @coderelay/web
npm test --workspace @coderelay/shared
npm test --workspace @coderelay/transport
```

## Host 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | 无，必填 | Host API 访问令牌，至少 16 字符 |
| `PORT` | `3000` | Host 监听端口；开发脚本通常用 `3002` |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude 历史项目目录，必须是绝对路径 |
| `CLAUDE_IMAGE_CACHE_DIR` | `<projects 同级>/image-cache` | Claude 粘贴图片缓存目录 |
| `PERMISSION_MODE` | `default` | `default` / `acceptEdits` / `bypassPermissions` |
| `SESSION_IDLE_TIMEOUT_MS` | `180000` | 活跃会话空闲回收时间 |
| `SESSION_HEARTBEAT_TTL_MS` | `45000` | Web 接管心跳租约时间 |
| `SESSION_ORPHAN_IDLE_TIMEOUT_MS` | `60000` | 无前台接管的空闲会话回收时间 |
| `MAX_CONCURRENT_SESSIONS` | `3` | Host 同时运行的 Claude agent 上限 |
| `UPLOADS_DIR` | `<cwd>/uploads` | 图片上传保存目录 |
| `CODERELAY_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGINS` | 空 | 额外允许的 CORS origins，逗号分隔 |

## P2P 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `P2P_SIGNAL_URL` / `CODERELAY_SIGNAL_URL` | 空 | 设置后启用 P2P |
| `P2P_HOST_ID` | `coderelay-host-<hostname>` | Host 稳定 ID |
| `P2P_WEB_URL` | `http://127.0.0.1:3000` | 二维码里给手机打开的 Web 地址 |
| `P2P_ICE_LOCAL_ADDRESS` / `P2P_ICE_LOCAL_ADDRESSES` | 空 | 暴露给 WebRTC 的本机候选地址，逗号分隔 |
| `P2P_PAIRING_TTL_MS` | `120000` | 配对二维码有效期 |
| `P2P_STATE_FILE` | `~/.coderelay/p2p-host-state.json` | Host 身份和受信设备存储文件 |
| `VITE_CODERELAY_SIGNAL_URL` | 空 | Web 前端默认 Signal 地址；扫码短链里的 `#signal=...` 会覆盖它 |
| `STUN_URL` / `STUN_URLS` | 空 | Signal 运行时下发的 STUN ICE server，多个 URL 用逗号分隔 |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | 空 | Signal 运行时下发的 TURN ICE server |
| `ICE_SERVERS_JSON` | 空 | Signal 运行时下发的完整 ICE server JSON 数组，优先于 `STUN_*` / `TURN_*` |

## Web 使用说明

打开 Web 后：

1. HTTP 模式输入 `AUTH_TOKEN` 登录。
2. P2P 短链或二维码打开时，Web 会先完成设备配对和 P2P 连接。
3. 左侧选择项目和历史会话。
4. 点击接管/继续，把历史会话恢复为活跃会话。
5. 输入消息继续聊天。
6. Claude 触发权限、问题或 plan 时，在页面卡片中处理。

模式菜单参考 Claude Code / VSCode 插件语义：

- `Auto`：推荐默认模式。
- `Plan`：进入计划模式，Claude 给出计划后需要批准。
- `Accept Edits`：自动接受编辑类操作。
- `Bypass Permissions`：高风险模式，危险操作不再逐项确认。

## Host 管理页

Host 管理页地址：

```text
http://<host-ip>:3002/host
```

当前用于：

- 生成手机配对二维码。
- 查看受信设备。
- 撤销设备授权。
- 查看设备近期使用时间、连接类型和多个 P2P 活跃连接。

Host 管理页走 Host HTTP，不默认依赖 P2P，也不要求输入 Web 端 token。

## 安全注意

CodeRelay 连接的是本机 Claude Code，具备读写文件、执行命令、审批工具调用的能力。请把 Host 暴露范围控制在可信网络内。

- 不要把开发 token 暴露到公网。
- `bypassPermissions` 风险很高，只在完全信任当前网络和设备时使用。
- P2P 配对后，手机端会保存 Host 公钥和信任信息；除非 Host 主动撤销该设备，否则后续可自动重连。
- 每个授权设备独立管理；撤销其中一个设备只会断开该设备，不影响其它已授权设备。
- Signal 不是权限边界，真正授权以 Host 的设备信任和 API token 为准。

## 测试策略

本仓库强制 TDD。任何功能变更和 bugfix 都应先写失败测试，再写实现。

常用测试层次：

- Host：Express 路由、Session 状态机、P2P runtime、JSONL 解析。
- Web：React 组件、会话 reducer、P2P 客户端。
- Shared：共享事件和 API 契约。
- Transport：HTTP/P2P 传输、WebRTC DataChannel。

提交前建议至少运行：

```bash
npm test
npm run build
```

## 开发约定

- 交流、文档和提交说明尽量使用中文。
- 修改 `packages/shared` 后要重新构建，确保 Host/Web 获取最新类型。
- 不提交运行日志、上传图片、测试报告和本地缓存。
- 遇到端口无响应，先检查是否有游离进程占用 `3000`、`3002`、`8787`。

## 相关文档

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [技术债务与改进规划](./docs/TECH-DEBT.md)
- [会话发布订阅与消息模型设计](./docs/superpowers/specs/2026-06-19-coderelay-session-pubsub-design.md)
