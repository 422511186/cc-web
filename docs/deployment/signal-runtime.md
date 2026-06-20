# Signal 运行与配置

CodeRelay Signal 是轻量 WebSocket 信令服务。它只负责 Host 和 Web 之间的上线、配对、连接挑战、offer/answer/ICE 转发。

## 先看变量生效时机

Signal 的环境变量是**进程启动时读取**的。

当前默认启动入口只读取：

- `PORT`

改了 `PORT` 或未来新增的 Signal 环境变量后，需要**重启 Signal 进程**。这些变量不是构建时注入到 `dist` 的。

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

当前内置启动入口只读取 `PORT`。

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

当前代码里的 Signal Hub 已支持向客户端下发 `iceServers`，但默认 `apps/signal/src/index.ts` 启动入口目前只读取 `PORT`，还没有实现 `TURN_*` 环境变量解析。

因此当前生产选择是：

- 局域网、ZeroTier、Tailscale 或可路由网络：通常不需要 TURN。
- 普通公网复杂 NAT：需要后续补一个 Signal 启动封装，调用 `startSignalServer({ iceServers })` 注入 TURN 配置，或者在 Signal 入口里增加 `TURN_*` 环境变量解析。

不要把 CodeRelay Signal 当作 TURN。Signal 只交换信令，TURN 是 WebRTC 数据通道层的中继服务。
