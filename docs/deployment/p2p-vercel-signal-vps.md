# P2P: Vercel Web + VPS Signal

这是推荐的公网入口方案：

- Web 部署到 Vercel。
- Signal 部署到 VPS 或云服务器。
- Host 仍然运行在自己的电脑或工作站上。
- 浏览器和 Host 通过 WebRTC DataChannel 通信。

最终结果：

- 用户打开的是 Vercel 上的 HTTPS Web 页面。
- Web 和 Host 都连接同一个公网 Signal。
- Signal 只帮助双方完成配对和 WebRTC 建连。
- 建连成功后，业务请求走浏览器和 Host 之间的 DataChannel。
- Host 不需要公网入站地址，也不需要把 Host API 暴露给公网。

操作顺序：

1. 在 VPS 上部署 Signal，并通过 `wss://signal.example.com/` 暴露。
2. 在 Vercel 上部署 Web。`VITE_CODERELAY_SIGNAL_URL` 可作为默认 Signal，但扫码配对会优先使用二维码短链里的 `#signal=...`。
3. 在 Host 机器上启动 Host，并设置 `P2P_SIGNAL_URL`、`P2P_WEB_URL`。
4. 打开 Host 管理页生成二维码。
5. 手机扫码配对并连接 P2P。

## 拓扑

```text
手机 / 浏览器
  |
  +-- HTTPS --> CodeRelay Web on Vercel
  |
  +-- WSS ----> CodeRelay Signal on VPS

CodeRelay Host on workstation
  |
  +-- WSS ----> CodeRelay Signal on VPS

手机 / 浏览器 == WebRTC DataChannel == CodeRelay Host
```

Signal 只负责配对和信令。P2P 建立成功后，业务数据不经过 Signal。

## 域名示例

```text
Web:    https://web.example.com
Signal: wss://signal.example.com/
Host:   不暴露公网，只出站连接 Signal
```

## 1. 部署 Signal 到 VPS

在 VPS 上：

```bash
git clone <repo-url> /opt/coderelay
cd /opt/coderelay
npm ci
npm run build
PORT=8787 \
STUN_URLS=stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478 \
node apps/signal/dist/index.js
```

建议使用 systemd 托管，详见 [Signal 运行与配置](./signal-runtime.md)。

Nginx WSS 反向代理示例：

```nginx
server {
  listen 443 ssl http2;
  server_name signal.example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }

  location = /healthz {
    proxy_pass http://127.0.0.1:8787/healthz;
  }
}
```

验证：

```bash
curl https://signal.example.com/healthz
```

期望返回：

```json
{"ok":true,"service":"coderelay-signal"}
```

## 2. 部署 Web 到 Vercel

Vercel 配置：

| 配置项 | 值 |
| --- | --- |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `apps/web/dist` |

可选环境变量：

```text
VITE_CODERELAY_SIGNAL_URL=wss://signal.example.com/
```

注意：`VITE_CODERELAY_SIGNAL_URL` 是构建时变量。修改后需要重新部署 Web。它只是默认值；Host 生成二维码时会把当前 `P2P_SIGNAL_URL` 写进短链 hash，扫码配对优先使用这个运行时地址。

详见 [Web 构建与托管](./web-runtime.md)。

## 3. 启动 Host

Host 机器上：

```bash
git clone <repo-url> /opt/coderelay
cd /opt/coderelay
npm ci
npm run build
```

启动：

```bash
AUTH_TOKEN=replace-with-a-long-random-token \
PORT=3002 \
CLAUDE_PROJECTS_DIR=/absolute/path/to/.claude/projects \
UPLOADS_DIR=/var/lib/coderelay/uploads \
P2P_SIGNAL_URL=wss://signal.example.com/ \
P2P_WEB_URL=https://web.example.com \
P2P_HOST_ID=coderelay-main-host \
P2P_STATE_FILE=/var/lib/coderelay/p2p-host-state.json \
node apps/host/dist/index.js
```

说明：

- `P2P_SIGNAL_URL` 是 Host 实际连接并写入二维码短链的 Signal 地址。
- `P2P_WEB_URL` 是 Host 管理页生成二维码时写入的 Web 地址，必须是手机能打开的 HTTPS 地址。
- `P2P_HOST_ID` 应保持稳定。
- `P2P_STATE_FILE` 必须持久化。
- Host 不需要公网入站，只要能出站连接 `wss://signal.example.com/`。

## 4. 配对

1. 打开 Host 管理页：`http://<host-ip>:3002/host`。
2. 点击添加设备，生成二维码。
3. 手机扫描二维码，打开形如 `https://web.example.com/pair/ABCD12#signal=...` 的配对短链。
4. Host 管理页接受设备配对。
5. Web 建立 P2P 连接后，进入会话页面。

首次配对后，手机会保存 Host 公钥和信任信息。后续打开 Web 时可以基于已保存的信任信息重新连接，不需要每次扫码。

## 5. 验证

- Web 页面能打开。
- Signal 健康检查正常。
- Host 管理页能生成二维码。
- 手机扫码后 Host 管理页能看到设备配对请求。
- P2P 状态显示已连接。
- 会话列表、历史消息、发送消息、权限确认、Plan 审批都能通过 P2P 使用。
- Signal 重启不应影响已经建立的当前 DataChannel，但会影响新的配对和新的连接建立。

## NAT 和 TURN

这个方案仍然受 WebRTC NAT 穿透能力限制。如果 Host 和手机处在复杂 NAT、公司网络或运营商 CGNAT 后面，直连可能失败。

建议在公网 Signal 上至少配置 STUN：

```bash
PORT=8787 \
STUN_URLS=stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478 \
node apps/signal/dist/index.js
```

STUN 可以让 WebRTC 收集 `srflx` 公网反射候选，但不能保证所有 NAT 都能打洞成功。需要公网级稳定穿透时，应部署标准 TURN/coturn，并通过 Signal 的 `TURN_URL`、`TURN_USERNAME`、`TURN_CREDENTIAL` 或 `ICE_SERVERS_JSON` 下发。

不要把 Signal 当成 TURN 中继。Signal 只负责配对和信令；业务数据仍走 WebRTC DataChannel，TURN 是 WebRTC 层的标准中继。
