# P2P: VPS 静态 Web + VPS Signal

这个方案适合不想使用 Vercel，希望把 Web 静态站和 Signal 都部署在自己的 VPS 上的情况。

Host 仍然运行在自己的电脑或工作站上，不建议放到 VPS，除非 VPS 本身就是你的 Claude Code 工作环境。

最终结果：

- VPS 负责两件事：托管 Web 静态文件、运行 Signal。
- Host 仍然在你的电脑或工作站上运行。
- 手机打开 VPS 上的 HTTPS Web 页面。
- Web 和 Host 都连接 VPS 上的 WSS Signal。
- P2P 建连成功后，业务请求走浏览器和 Host 之间的 DataChannel。

操作顺序：

1. 在 VPS 上构建 Web 和 Signal。
2. 用 Nginx/Caddy 发布 Web 静态目录。
3. 在 VPS 上启动 Signal，并通过 WSS 暴露。
4. 在 Host 机器上启动 Host，并指向 VPS 上的 Signal 和 Web 地址。
5. 手机扫码配对并连接 P2P。

## 拓扑

```text
VPS
  ├── Nginx 静态托管 CodeRelay Web
  └── CodeRelay Signal on 127.0.0.1:8787，经 Nginx 暴露 WSS

Host 工作站
  └── 出站连接 wss://signal.example.com/

手机 / 浏览器
  ├── HTTPS 访问 Web
  └── WSS 连接 Signal

手机 / 浏览器 == WebRTC DataChannel == Host 工作站
```

推荐使用两个域名：

```text
web.example.com
signal.example.com
```

也可以使用同一个域名的不同路径，但当前 Signal WebSocket 默认 path 是 `/`，同域路径部署需要额外调整反向代理和前端 Signal URL。简单起见，推荐两个域名。

## 1. 在 VPS 构建 Web 和 Signal

```bash
git clone <repo-url> /opt/coderelay
cd /opt/coderelay
npm ci
VITE_CODERELAY_SIGNAL_URL=wss://signal.example.com/ npm run build
```

`VITE_CODERELAY_SIGNAL_URL` 是 Web 的默认 Signal 地址。扫码配对时，Host 生成的二维码短链会携带 `#signal=...`，浏览器会优先使用二维码里的运行时 Signal 地址。

构建结果：

```text
apps/web/dist
apps/signal/dist
```

## 2. 启动 Signal

```bash
cd /opt/coderelay
PORT=8787 \
STUN_URLS=stun:stun.cloudflare.com:3478,stun:global.stun.twilio.com:3478 \
node apps/signal/dist/index.js
```

建议使用 systemd 托管，详见 [Signal 运行与配置](./signal-runtime.md)。

## 3. 发布 Web 静态目录

```bash
rm -rf /var/www/coderelay-web
mkdir -p /var/www/coderelay-web
cp -R /opt/coderelay/apps/web/dist/. /var/www/coderelay-web/
```

Nginx 配置示例：

```nginx
server {
  listen 443 ssl http2;
  server_name web.example.com;

  root /var/www/coderelay-web;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}

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

打开：

```text
https://web.example.com
```

## 4. 启动 Host

在 Host 工作站上：

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

## 5. 更新部署

更新 Web 或 Signal：

```bash
cd /opt/coderelay
git pull
npm ci
VITE_CODERELAY_SIGNAL_URL=wss://signal.example.com/ npm run build
sudo systemctl restart coderelay-signal
rm -rf /var/www/coderelay-web
mkdir -p /var/www/coderelay-web
cp -R apps/web/dist/. /var/www/coderelay-web/
```

更新 Host：

```bash
cd /opt/coderelay
git pull
npm ci
npm run build
sudo systemctl restart coderelay-host
```

Windows Host 则按你使用的任务计划程序、nssm 或手动进程重启方式处理。
