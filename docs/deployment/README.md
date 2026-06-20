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
