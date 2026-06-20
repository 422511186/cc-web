# Web 构建与托管

CodeRelay Web 是 React + Vite 前端。它可以走 HTTP 模式，也可以走 P2P 模式。

## 先看变量生效时机

Web 相关变量最容易配错，先记这一条：

- `VITE_*`：**构建时注入**。执行 `npm run build` 时写进前端产物。改完后必须重新构建并重新部署 Web。
- `CODERELAY_DEV_API_TARGET`：**启动开发服务器时读取**。只影响 `npm run dev:web` 的本地 Vite 代理，不影响生产静态产物。

换句话说：

- 生产 Web 如果已经构建好了，只改服务器上的环境变量，不会让浏览器里已经打包好的 `VITE_*` 自动变化。
- 开发模式下修改 `CODERELAY_DEV_API_TARGET`，需要重启 `npm run dev:web`。

## 构建方式

推荐在仓库根目录构建：

```bash
npm ci
npm run build
```

Web 静态产物位于：

```text
apps/web/dist
```

这个目录可以独立发布到 Vercel、Nginx、Caddy、对象存储或任意静态托管平台。

注意：Web 依赖 workspace 包。单独执行 `npm run build --workspace @coderelay/web` 前，需要确保共享包已经构建。最稳妥的是直接用根目录 `npm run build`。

## 构建时环境变量

| 变量 | 适用模式 | 说明 |
| --- | --- | --- |
| `VITE_CODERELAY_SIGNAL_URL` | P2P | Web 连接 Signal 的地址，例如 `wss://signal.example.com/` |
| `VITE_CODERELAY_API_BASE` | HTTP | Web 直连 Host API 的地址，例如 `https://host.example.com/api` 或 `http://192.168.1.20:3002/api` |

Vite 的 `VITE_*` 变量是在构建时写入前端包的。修改这些变量后，必须重新构建并重新部署 Web。

## 开发模式变量

本地开发时，Vite dev server 还会读取：

| 变量 | 生效时机 | 说明 |
| --- | --- | --- |
| `CODERELAY_DEV_API_TARGET` | 启动 `npm run dev:web` 时 | 控制 `/api` 代理到哪个 Host API，默认 `http://localhost:3002` |

示例：

```bash
CODERELAY_DEV_API_TARGET=http://192.168.1.20:3002 npm run dev:web
```

这个变量只影响开发服务器代理，不会写进 `apps/web/dist`。

## Vercel 部署

推荐配置：

| 配置项 | 值 |
| --- | --- |
| Framework Preset | `Vite` 或 `Other` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `apps/web/dist` |

P2P 模式需要在 Vercel 项目环境变量里配置：

```text
VITE_CODERELAY_SIGNAL_URL=wss://signal.example.com/
```

HTTP 直连模式需要配置：

```text
VITE_CODERELAY_API_BASE=https://host.example.com/api
```

如果 Host 没有公网 HTTPS 地址，不建议在 Vercel Web 上使用 HTTP 直连模式。此时应使用 P2P 模式，让 Web 只连接公网 Signal。

## Nginx 静态托管

示例：

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
```

部署：

```bash
rm -rf /var/www/coderelay-web
mkdir -p /var/www/coderelay-web
cp -R apps/web/dist/. /var/www/coderelay-web/
```

## Caddy 静态托管

示例：

```caddyfile
web.example.com {
  root * /var/www/coderelay-web
  try_files {path} /index.html
  file_server
}
```

## 本地预览

构建后可以用 Vite preview 做本地预览：

```bash
npm run preview --workspace @coderelay/web
```

这只适合验证，不建议把 `vite preview` 当作正式长期运行服务。
