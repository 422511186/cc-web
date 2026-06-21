# Host 运行与配置

CodeRelay Host 是真正接管 Claude Code 的进程。它必须运行在已经安装并能正常使用 Claude Code 的个人电脑、工作站或远程开发机上。

## 先看变量生效时机

Host 的环境变量都是**进程启动时读取**的。

也就是说：

- 先设置环境变量，再执行 `node apps/host/dist/index.js` 或 `npm run start --workspace @coderelay/host`。
- 改了 `AUTH_TOKEN`、`P2P_SIGNAL_URL`、`P2P_WEB_URL`、`CLAUDE_PROJECTS_DIR` 这类变量后，需要**重启 Host 进程**才会生效。
- 这些变量不是构建时写进 `dist` 的，重新 `npm run build` 不是为了让变量生效，而是为了生成最新代码。

## Host 负责什么

- 读取 Claude Code 历史目录。
- 通过 Claude Agent SDK 新建或续聊 Claude Code 会话。
- 提供 HTTP API、SSE 流、上传图片接口和 Host 管理页。
- 在 P2P 模式下连接 Signal，并和浏览器建立 WebRTC DataChannel。
- 保存 Host 身份、公钥和受信设备列表。

Host 具备读写本机文件、执行命令和审批工具调用的能力。生产环境不要把 Host API 直接暴露到公网，除非你非常明确地配置了认证、TLS、网络访问控制和审计。

## 构建方式

在仓库根目录执行：

```bash
npm ci
npm run build
```

Host 编译结果位于：

```text
apps/host/dist
```

这不是独立安装包。运行时仍需要仓库目录、`package.json`、workspace 包和 `node_modules`。

## 最小生产启动

Linux / macOS:

```bash
AUTH_TOKEN=replace-with-a-long-random-token \
PORT=3002 \
CLAUDE_PROJECTS_DIR=/absolute/path/to/.claude/projects \
UPLOADS_DIR=/var/lib/coderelay/uploads \
node apps/host/dist/index.js
```

Windows PowerShell:

```powershell
$env:AUTH_TOKEN="replace-with-a-long-random-token"
$env:PORT="3002"
$env:CLAUDE_PROJECTS_DIR="C:\Path\To\.claude\projects"
$env:UPLOADS_DIR="C:\CodeRelay\data\uploads"
node apps\host\dist\index.js
```

也可以使用 npm script：

```bash
npm run start --workspace @coderelay/host
```

## P2P 模式启动

Linux / macOS:

```bash
AUTH_TOKEN=replace-with-a-long-random-token \
PORT=3002 \
CLAUDE_PROJECTS_DIR=/absolute/path/to/.claude/projects \
UPLOADS_DIR=/var/lib/coderelay/uploads \
P2P_SIGNAL_URL=wss://signal.example.com/ \
P2P_WEB_URL=https://web.example.com \
P2P_HOST_ID=coderelay-main-host \
P2P_STATE_FILE=/var/lib/coderelay/p2p-host-state.json \
P2P_ICE_LOCAL_ADDRESS=192.168.1.20 \
node apps/host/dist/index.js
```

Windows PowerShell:

```powershell
$env:AUTH_TOKEN="replace-with-a-long-random-token"
$env:PORT="3002"
$env:CLAUDE_PROJECTS_DIR="C:\Path\To\.claude\projects"
$env:UPLOADS_DIR="C:\CodeRelay\data\uploads"
$env:P2P_SIGNAL_URL="wss://signal.example.com/"
$env:P2P_WEB_URL="https://web.example.com"
$env:P2P_HOST_ID="coderelay-main-host"
$env:P2P_STATE_FILE="C:\CodeRelay\data\p2p-host-state.json"
$env:P2P_ICE_LOCAL_ADDRESS="192.168.1.20"
node apps\host\dist\index.js
```

`P2P_ICE_LOCAL_ADDRESS` 是可选项。它适合局域网、ZeroTier、Tailscale 或固定内网地址场景。多个地址可以用逗号分隔：

```bash
P2P_ICE_LOCAL_ADDRESSES=192.168.1.20,192.168.50.20
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | 无，必填 | Host API 访问令牌，至少 16 字符 |
| `PORT` | `3000` | Host 监听端口，开发脚本常用 `3002` |
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Claude 历史项目目录，必须是 Host 机器上的绝对路径 |
| `CLAUDE_IMAGE_CACHE_DIR` | `<projects 同级>/image-cache` | Claude 粘贴图片缓存目录 |
| `PERMISSION_MODE` | `default` | `default` / `acceptEdits` / `bypassPermissions` |
| `SESSION_IDLE_TIMEOUT_MS` | `180000` | 活跃会话空闲回收时间 |
| `SESSION_HEARTBEAT_TTL_MS` | `45000` | Web 接管心跳租约时间 |
| `SESSION_ORPHAN_IDLE_TIMEOUT_MS` | `60000` | 无前台接管的空闲会话回收时间 |
| `MAX_CONCURRENT_SESSIONS` | `3` | Host 同时运行的 Claude agent 上限 |
| `UPLOADS_DIR` | `<cwd>/uploads` | 图片上传保存目录 |
| `CODERELAY_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGINS` | 空 | 额外允许的 CORS origins，逗号分隔 |
| `P2P_SIGNAL_URL` / `CODERELAY_SIGNAL_URL` | 空 | 设置后启用 P2P；Host 生成二维码时会把该地址写入短链 `#signal=...` |
| `P2P_HOST_ID` | `coderelay-host-<hostname>` | Host 稳定 ID |
| `P2P_WEB_URL` | `http://127.0.0.1:3000` | Host 管理页二维码里写入的 Web 地址 |
| `P2P_ICE_LOCAL_ADDRESS` / `P2P_ICE_LOCAL_ADDRESSES` | 空 | 暴露给 WebRTC 的本机候选地址，逗号分隔 |
| `P2P_PAIRING_TTL_MS` | `120000` | 配对二维码有效期 |
| `P2P_STATE_FILE` | `~/.coderelay/p2p-host-state.json` | Host 身份和受信设备存储文件 |

## systemd 示例

适合 Linux 工作站或远程开发机：

```ini
[Unit]
Description=CodeRelay Host
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/coderelay
Environment=AUTH_TOKEN=replace-with-a-long-random-token
Environment=PORT=3002
Environment=CLAUDE_PROJECTS_DIR=/absolute/path/to/.claude/projects
Environment=UPLOADS_DIR=/var/lib/coderelay/uploads
Environment=P2P_SIGNAL_URL=wss://signal.example.com/
Environment=P2P_WEB_URL=https://web.example.com
Environment=P2P_HOST_ID=coderelay-main-host
Environment=P2P_STATE_FILE=/var/lib/coderelay/p2p-host-state.json
ExecStart=/usr/bin/node apps/host/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coderelay-host
sudo systemctl status coderelay-host
```

## 健康检查

```bash
curl http://127.0.0.1:3002/healthz
```

期望返回：

```json
{"ok":true,"service":"coderelay-host"}
```

Host 管理页：

```text
http://<host-ip>:3002/host
```

## 常见问题

- `AUTH_TOKEN environment variable is required`：没有设置 `AUTH_TOKEN`。
- `AUTH_TOKEN must be at least 16 characters`：令牌太短。
- `CLAUDE_PROJECTS_DIR must be an absolute path`：历史目录必须是绝对路径。
- 手机能打开 Web 但 P2P 连不上：检查 Host 的 `P2P_SIGNAL_URL` 是否正确，并确认二维码短链里带有对应的 `#signal=...`。
- 二维码打开了错误地址：检查 `P2P_WEB_URL`，它必须是手机可访问的 Web 地址。
- 授权设备丢失：检查 `P2P_STATE_FILE` 是否被删除或放在了临时目录。
