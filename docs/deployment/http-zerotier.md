# HTTP / ZeroTier 部署

这个方案适合手机和电脑已经在同一个可信网络里，例如：

- 同一局域网。
- ZeroTier 虚拟局域网。
- Tailscale / WireGuard 网络。
- 其他能让手机直接访问电脑 IP 的网络。

最终结果：

- Host 跑在你的电脑或工作站上。
- Web 可以跑在同一台电脑、本机开发服务器或静态服务器上。
- 手机浏览器直接访问 Web，Web 再通过 HTTP/SSE 访问 Host。
- 不启动 Signal，不使用 WebRTC，不需要扫码配对。

操作顺序：

1. 在 Host 机器上构建并启动 Host。
2. 启动或部署 Web。
3. 手机打开 Web 地址。
4. 输入 `AUTH_TOKEN` 登录。

## 拓扑

```text
手机 / 浏览器  -- HTTP/SSE -->  CodeRelay Host  -- Claude Agent SDK --> Claude Code
      |
      +-- 访问 CodeRelay Web 静态页面或 Vite dev server
```

这个方案不需要 Signal，也不需要 WebRTC。浏览器直接通过 HTTP/SSE 访问 Host API。

## 适合和不适合

适合：

- 你已经用 ZeroTier 跑通了手机访问电脑 IP。
- 你只在自己的可信网络里使用。
- 你希望部署链路最简单。

不适合：

- Web 部署在公网 HTTPS，但 Host 只有内网 HTTP 地址。
- 手机不在能访问 Host 的网络里。
- 你不想让浏览器直接连 Host API。

## Host 启动

在 Host 机器上构建：

```bash
npm ci
npm run build
```

启动：

```bash
AUTH_TOKEN=replace-with-a-long-random-token \
PORT=3002 \
CLAUDE_PROJECTS_DIR=/absolute/path/to/.claude/projects \
UPLOADS_DIR=/var/lib/coderelay/uploads \
node apps/host/dist/index.js
```

Windows PowerShell：

```powershell
$env:AUTH_TOKEN="replace-with-a-long-random-token"
$env:PORT="3002"
$env:CLAUDE_PROJECTS_DIR="C:\Path\To\.claude\projects"
$env:UPLOADS_DIR="C:\CodeRelay\data\uploads"
node apps\host\dist\index.js
```

验证：

```bash
curl http://<host-ip>:3002/healthz
```

## Web 启动方式一：开发模式

适合本地验证：

```bash
CODERELAY_DEV_API_TARGET=http://<host-ip>:3002 npm run dev:web
```

Windows PowerShell：

```powershell
$env:CODERELAY_DEV_API_TARGET="http://<host-ip>:3002"
npm run dev:web
```

手机访问：

```text
http://<web-ip>:3000
```

## Web 启动方式二：静态构建

如果 Web 静态页和 Host API 不同源，需要在构建时写入 API 地址：

```bash
VITE_CODERELAY_API_BASE=http://<host-ip>:3002/api npm run build
```

Windows PowerShell：

```powershell
$env:VITE_CODERELAY_API_BASE="http://<host-ip>:3002/api"
npm run build
```

然后发布：

```text
apps/web/dist
```

如果 Web 和 Host API 跨域，还需要给 Host 配置允许来源：

```bash
CODERELAY_ALLOWED_ORIGINS=http://<web-origin>
```

例如：

```bash
CODERELAY_ALLOWED_ORIGINS=http://192.168.1.20:3000
```

## 登录和访问

打开 Web 后输入 `AUTH_TOKEN` 登录。HTTP 模式下所有业务请求都直接访问 Host API。

Host 管理页：

```text
http://<host-ip>:3002/host
```

HTTP / ZeroTier 模式不依赖 Host 管理页里的 P2P 配对二维码。

## 安全提醒

- 只在可信网络内使用。
- 不要使用开发 token。
- `AUTH_TOKEN` 至少 16 字符，建议使用随机长字符串。
- 如果使用 `bypassPermissions`，远程页面可以批准高风险操作，务必确认设备和网络可信。
