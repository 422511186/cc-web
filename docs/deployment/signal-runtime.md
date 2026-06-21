# Signal 运行与配置

CodeRelay Signal 是轻量 WebSocket 信令服务。它只负责 Host 和 Web 之间的上线、配对、连接挑战、offer/answer/ICE 转发。

## 先看变量生效时机

Signal 的环境变量是**进程启动时读取**的。

当前默认启动入口读取：

- `PORT`
- `STUN_URL` / `STUN_URLS`
- `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL`
- `ICE_SERVERS_JSON`

改了这些变量后，需要**重启 Signal 进程**。这些变量不是构建时注入到 `dist` 的。

Signal 不负责：

- 存储聊天内容。
- 转发业务 API 请求。
- 作为权限边界。
- 作为 TURN 中继。

P2P DataChannel 建立成功后，聊天、会话列表、历史消息、图片读取等业务数据走浏览器和 Host 之间的 WebRTC 连接。

## 构建方式

在仓库根目录执行：

```bash
npm ci
npm run build
```

Signal 编译结果位于：

```text
apps/signal/dist
```

这不是独立安装包。运行时仍需要仓库目录、`package.json`、workspace 包和 `node_modules`。

## 启动 Signal

```bash
PORT=8787 node apps/signal/dist/index.js
```

也可以使用 npm script：

```bash
PORT=8787 npm run start --workspace @coderelay/signal
```

如果要提高公网 P2P 直连成功率，建议至少配置 STUN：

```bash
PORT=8787 \
STUN_URLS=stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478 \
node apps/signal/dist/index.js
```

也可以用 JSON 一次性配置完整 ICE servers：

```bash
ICE_SERVERS_JSON='[
  {"urls":"stun:stun.cloudflare.com:3478"},
  {"urls":"turn:turn.example.com:3478","username":"turn-user","credential":"turn-pass"}
]' \
PORT=8787 \
node apps/signal/dist/index.js
```

`ICE_SERVERS_JSON` 优先级最高；设置后会忽略 `STUN_URL(S)` 和 `TURN_*`。

## ICE / STUN / TURN 配置

Signal 不承载业务流量，也不自己充当 STUN/TURN 服务器。它只把 ICE server 配置下发给 Host 和 Web，让 WebRTC 自己完成候选收集、打洞或中继选择。

| 变量 | 说明 |
| --- | --- |
| `STUN_URL` | 单个 STUN URL，例如 `stun:stun.cloudflare.com:3478` |
| `STUN_URLS` | 多个 STUN URL，逗号分隔；优先于 `STUN_URL` |
| `TURN_URL` | 单个 TURN URL，例如 `turn:turn.example.com:3478` 或 `turns:turn.example.com:5349` |
| `TURN_USERNAME` | TURN 用户名 |
| `TURN_CREDENTIAL` | TURN 密码或凭据 |
| `ICE_SERVERS_JSON` | 完整 ICE server JSON 数组；每项当前使用字符串 `urls` 字段 |

纯 STUN 只能帮助双方发现公网反射地址，不能保证所有 NAT 都能打洞成功。需要更稳定的公网可达性时，应部署标准 TURN 服务，例如 coturn，然后通过 `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` 下发。

## 健康检查

```bash
curl http://127.0.0.1:8787/healthz
```

期望返回：

```json
{"ok":true,"service":"coderelay-signal"}
```

## Nginx WSS 反向代理

生产环境建议给 Signal 配 HTTPS/WSS。示例：

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

Web 如果通过 `https://` 加载，Signal 地址应该使用：

```text
wss://signal.example.com/
```

不要在 HTTPS 页面里使用 `ws://`，浏览器通常会按混合内容拦截。

## systemd 示例

```ini
[Unit]
Description=CodeRelay Signal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/coderelay
Environment=PORT=8787
Environment=STUN_URLS=stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478
ExecStart=/usr/bin/node apps/signal/dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coderelay-signal
sudo systemctl status coderelay-signal
```

## TURN 说明

WebRTC 跨复杂 NAT、公司网络或运营商 CGNAT 时，纯打洞可能失败。这种场景需要标准 TURN 服务作为 WebRTC 中继兜底，通常用 `coturn` 部署在公网服务器上。

当前生产选择是：

- 局域网、ZeroTier、Tailscale 或可路由网络：通常不需要 TURN，可以不配置 ICE server 或只配置 STUN。
- 普通公网 NAT：先配置 `STUN_URLS`，观察 Host 管理页和日志里是否出现 `srflx` candidate。
- 复杂 NAT、公司网络或运营商 CGNAT：配置标准 TURN/coturn，并通过 `TURN_*` 或 `ICE_SERVERS_JSON` 下发。

不要把 CodeRelay Signal 当作 TURN。Signal 只交换信令，TURN 是 WebRTC 数据通道层的中继服务。
