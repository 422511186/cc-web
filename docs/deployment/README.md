# CodeRelay 部署文档

CodeRelay 部署时要先分清三个角色：Host、Web、Signal。多数困惑都来自把这三者混在一起。

## 三个组件放在哪里

| 组件 | 必须放在哪里 | 作用 | 能否独立部署 |
| --- | --- | --- | --- |
| Host | 运行 Claude Code 的电脑、工作站或远程开发机 | 接管 Claude Code、读写本机文件、管理设备授权 | 需要 Node.js、仓库代码和依赖 |
| Web | Vercel、静态服务器、VPS、本机都可以 | 浏览器页面 | 构建后 `apps/web/dist` 可独立静态托管 |
| Signal | VPS、云服务器、本机都可以 | P2P 配对和 WebRTC 信令交换 | 需要 Node.js、仓库代码和依赖 |

最重要的一点：**Host 不建议部署到公网服务器，除非那台服务器本身就是你运行 Claude Code 的工作环境。** Host 拥有读写文件、执行命令和审批工具调用的能力。

## 推荐阅读顺序

1. 先读本页，理解三个组件的边界。
2. 按实际网络选择一个方案文档。
3. 遇到单个组件问题时，再看 Host / Web / Signal 的组件文档。
4. 上线前按检查清单逐项验证。

## 选择部署方案

| 你的情况 | 看这篇 | 说明 |
| --- | --- | --- |
| 手机能直接访问电脑 IP | [HTTP / ZeroTier 部署](./http-zerotier.md) | 最简单，不需要 P2P，不需要 Signal |
| Web 想放 Vercel，Host 不想暴露公网 | [P2P: Vercel Web + VPS Signal](./p2p-vercel-signal-vps.md) | 推荐公网入口方案 |
| 不想用 Vercel，想自己托管 Web | [P2P: VPS 静态 Web + VPS Signal](./p2p-static-vps.md) | Web 静态站和 Signal 都放自己的服务器 |

## 当前打包形态

CodeRelay 目前是 npm workspaces 项目，不是 Docker 镜像、单文件二进制或完整安装包。

构建后会得到：

- `apps/host/dist`：Host 的 Node.js 编译产物。
- `apps/signal/dist`：Signal 的 Node.js 编译产物。
- `apps/web/dist`：Web 的静态站产物。

其中只有 `apps/web/dist` 可以单独复制到静态托管平台。Host 和 Signal 运行时仍需要仓库目录、workspace 包和 `node_modules`。

通用构建命令：

```bash
npm ci
npm run build
```

Host / Signal 可以直接用 Node.js 启动编译后的入口：

```bash
node apps/host/dist/index.js
node apps/signal/dist/index.js
```

也可以使用 npm script：

```bash
npm run start --workspace @coderelay/host
npm run start --workspace @coderelay/signal
```

## 环境变量：构建时注入，还是运行时读取？

这是部署 CodeRelay 时**最容易混淆**的一点。先记一句话总结：

- **Web 前端（`VITE_*`）= 构建时变量**。在 `npm run build` 时被写死进 `apps/web/dist` 的 JS 文件里。部署后改服务器上的环境变量**不会生效**，必须重新构建并重新部署 Web。
- **Host / Signal 后端 = 运行时变量**。所有环境变量都在进程启动时读取。改完只需**重启进程**即可生效，不需要重新 `npm run build`（build 只是为了更新代码本身）。
- **Web 开发服务器（`CODERELAY_DEV_API_TARGET`）= 开发服务器启动时变量**。只影响 `npm run dev:web` 的本地代理，不进生产产物。

完整对照表：

| 变量 | 属于 | 注入时机 | 改了之后如何生效 |
| --- | --- | --- | --- |
| `VITE_CODERELAY_SIGNAL_URL` | Web | 构建时 | 重新 `npm run build` + 重新部署 Web |
| `VITE_CODERELAY_API_BASE` | Web | 构建时 | 重新 `npm run build` + 重新部署 Web |
| `CODERELAY_DEV_API_TARGET` | Web 开发服务器 | `npm run dev:web` 启动时 | 重启 dev server（不影响生产产物） |
| `AUTH_TOKEN` / `PORT` / `CLAUDE_PROJECTS_DIR` / `PERMISSION_MODE` 等全部 Host 变量 | Host | 进程启动时 | 重启 Host 进程 |
| `P2P_SIGNAL_URL` / `P2P_WEB_URL` / `P2P_HOST_ID` 等全部 P2P 变量 | Host | 进程启动时 | 重启 Host 进程 |
| `PORT`（Signal） | Signal | 进程启动时 | 重启 Signal 进程 |

判断方法：**带 `VITE_` 前缀的就是 Web 构建时变量，其余 Host / Signal 变量都是后端运行时变量。**

### “指向哪个 Signal” 要配两次

P2P 模式里，Host 和 Web 都需要知道 Signal 地址，但它们**用不同的变量、在不同的时机**配置，而且两者必须指向同一个 Signal：

| 谁要连 Signal | 用哪个变量 | 注入时机 | 改了之后怎么生效 |
| --- | --- | --- | --- |
| Host | `P2P_SIGNAL_URL`（或 `CODERELAY_SIGNAL_URL`） | 运行时，启动 Host 前设置 | 重启 Host 进程 |
| Web | `VITE_CODERELAY_SIGNAL_URL` | 构建时，`npm run build` 时写入前端包 | 重新构建 + 重新部署 Web |

所以在 Vercel 这类平台上，`VITE_CODERELAY_SIGNAL_URL` 要配在**项目的构建环境变量**里、并触发一次重新部署；它不是 Host 运行时读取的，也不能在 Host 上设置。最常见的错误就是：只改了 Web 服务器上的环境变量却没重新构建，浏览器里跑的还是旧的 Signal 地址。

## 组件文档

- [Host 运行与配置](./host-runtime.md)：Host 的环境变量、P2P 配置、systemd 示例、健康检查。
- [Signal 运行与配置](./signal-runtime.md)：Signal 启动、WSS 反代、TURN 边界。
- [Web 构建与托管](./web-runtime.md)：Vercel、Nginx、Caddy、构建时环境变量。
- [上线检查清单](./production-checklist.md)：部署后逐项自查。

## 必须记住的边界

- Signal 不是权限边界，真正授权在 Host。
- Signal 不是 TURN 中继，只负责信令。
- P2P 建立后，业务数据走 WebRTC DataChannel。
- 生产 HTTPS 页面必须连接 `wss://` Signal。
- `VITE_*` 是 Web 构建时变量，改完要重新构建 Web。
- `P2P_STATE_FILE` 必须放在持久化磁盘，丢失后需要重新配对设备。
