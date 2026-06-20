# 上线检查清单

这份清单用于部署后自查。建议每次改 Signal 地址、Web 域名、Host 机器或 P2P 状态文件位置后都重新检查一遍。

## 构建与运行

- 根目录执行过 `npm ci`。
- 根目录执行过 `npm run build`。
- Host 使用 `node apps/host/dist/index.js` 或 `npm run start --workspace @coderelay/host` 启动。
- Signal 使用 `node apps/signal/dist/index.js` 或 `npm run start --workspace @coderelay/signal` 启动。
- Web 发布的是 `apps/web/dist`。
- Host / Signal 没有只复制 `dist` 到一台没有依赖和 workspace 包的机器上运行。

## Host

- `AUTH_TOKEN` 已设置，并且至少 16 字符。
- 没有使用开发 token。
- `CLAUDE_PROJECTS_DIR` 是 Host 机器上的绝对路径。
- `UPLOADS_DIR` 位于持久化磁盘。
- P2P 模式下 `P2P_STATE_FILE` 位于持久化磁盘。
- P2P 模式下 `P2P_HOST_ID` 稳定，不会每次启动变化。
- P2P 模式下 `P2P_WEB_URL` 是手机能打开的 Web 地址。
- Host 健康检查正常：

```bash
curl http://127.0.0.1:3002/healthz
```

## Signal

- Signal 健康检查正常：

```bash
curl https://signal.example.com/healthz
```

- HTTPS 页面使用的是 `wss://` Signal URL。
- Web 的 `VITE_CODERELAY_SIGNAL_URL` 和 Host 的 `P2P_SIGNAL_URL` 指向同一个 Signal。
- Nginx / Caddy 反代保留了 WebSocket Upgrade 头。
- Signal 没有被误认为 TURN 中继。

## Web

- `VITE_*` 环境变量是在构建前设置的。
- 修改 `VITE_CODERELAY_SIGNAL_URL` 或 `VITE_CODERELAY_API_BASE` 后重新构建并重新部署。
- P2P 模式下 Web 不需要公网直连 Host API。
- HTTP 模式下 Web 如果跨域访问 Host API，Host 配置了 `CODERELAY_ALLOWED_ORIGINS` 或 `CORS_ALLOWED_ORIGINS`。

## P2P 配对

- Host 管理页可以打开：

```text
http://<host-ip>:3002/host
```

- Host 管理页可以生成二维码。
- 二维码中的 Web 地址来自 `P2P_WEB_URL`，并且手机能访问。
- 手机扫码后 Host 管理页能看到配对请求。
- Host 接受配对后，手机能进入 Web。
- 后续重新打开 Web，不需要每次扫码。
- Host 撤销设备后，手机端能看到需要重新授权的提示。

## 功能验证

- 可以加载项目列表。
- 可以打开历史会话。
- 可以接管或继续会话。
- 可以发送消息并收到流式回复。
- 可以处理 AskUserQuestion。
- 可以处理工具权限确认。
- 可以批准或拒绝 Plan。
- 可以上传图片，并在聊天记录中看到图片。
- 可以切换 Claude Code 模式。
- 两个 Web 页面同时打开同一个会话时，消息能同步显示。

## 安全

- Host API 没有暴露到不可信公网。
- `bypassPermissions` 只在完全信任当前设备和网络时使用。
- Signal 可公网访问，但不被当作权限边界。
- 备份或迁移时包含 `P2P_STATE_FILE`。
- 不提交 `.env`、日志、上传图片、测试报告和本地缓存。

