# CodeRelay 设备配对、Host 管理页与 TURN 中继设计

日期：2026-06-19

## 背景

CodeRelay 的 P2P 链路已经具备 Signal 配对、设备信任、公钥挑战和 WebRTC DataChannel 承载能力。但当前体验仍有明显缺口：

- 二维码内容过长，手机难以扫描。
- Host 管理页需要承担设备授权、撤销、近期使用时间、链路状态和配置管理。
- 设备展示名仍暴露 `client-<hex>` 这类内部 ID。
- 设备撤销后，P2P 页面需要明确提示重新授权。
- Signal 已存在，TURN 配置下发已存在，但自研 Transit 中继不进入当前阶段。

本设计定义 Host 管理页和配对链路的目标形态。

## 目标

- Host 提供独立管理页面，默认走本机 HTTP，不要求 P2P token。
- 二维码放在 Host 管理页，而不是普通 Web 聊天页。
- 二维码改为短链接：`<PUBLIC_WEB_BASE_URL>/pair/<pairCode>`。
- 短链接基础地址可配置：环境变量提供默认值，Host 管理页可覆盖。
- 绑定设备使用友好名称展示，内部 ID 只在调试详情中出现。
- Host 可查看设备近期使用时间、连接类型、P2P 拓扑和 TURN 状态。
- Host 撤销设备后，在线 P2P 客户端立即断开并进入重新授权引导。
- 第一阶段中继采用标准 TURN/coturn，不做自研 WebSocket Transit。

## 非目标

- 不做云端账号体系。
- 不做跨 Host 的设备同步。
- 不实现自研流量中继服务。
- 不让 Host 管理页通过 P2P 访问自身。
- 不把 Signal 做成业务数据代理。Signal 只负责配对、上线、信令交换和 TURN 配置下发。

## Host 管理页

Host 管理页建议挂载在：

- `GET /host`：管理页面 HTML。
- `GET /api/host/status`：Host 状态。
- `GET /api/host/devices`：设备列表。
- `POST /api/host/pairings`：创建配对短码和二维码。
- `POST /api/host/devices/:deviceId/revoke`：撤销设备。
- `PATCH /api/host/devices/:deviceId`：重命名设备。
- `GET /api/host/network`：Signal、TURN、P2P 拓扑状态。
- `GET /api/host/settings` / `PATCH /api/host/settings`：管理可覆盖配置。

Host 管理 API 默认不要求 Web 端 `AUTH_TOKEN`，因为它是本机/局域网 Host 管理面。但它必须保持边界：

- 只挂在 Host 服务，不由 Web 静态部署方提供。
- 默认仅允许可信来源访问，可结合 Host 监听地址、CORS 和未来本机确认机制继续收紧。
- 管理页不通过 P2P 暴露。

## 可配置项

环境变量作为默认值：

- `PUBLIC_WEB_BASE_URL`：二维码短链接打开的 Web 地址，例如 `http://172.30.1.102:3100`。
- `PUBLIC_SIGNAL_URL`：手机/Web 连接 Signal 的地址，例如 `ws://172.30.1.102:3001`.
- `PUBLIC_HOST_URL`：可选，用于 HTTP 直连提示和诊断。

Host 管理页允许覆盖：

- Web 基础地址。
- Signal 地址。
- TURN/ICE 配置展示和测试状态。

覆盖配置存储在 Host 本地配置文件中。第一阶段可以使用 JSON 文件，后续再考虑系统 keychain 或数据库。环境变量仍作为默认值和重置来源。

## 短链接配对

旧模型把完整 pairing offer 放入二维码，内容包含公钥、Signal URL、Host ID、pairingId、pairingSecret 等，导致二维码密度过高。

新模型：

1. Host 点击“添加设备”。
2. Host 生成 `pairCode`、`pairingId`、`pairingSecret`，有效期建议 2 到 5 分钟。
3. Host 向 Signal 注册配对窗口，Signal 保存 `pairCode -> pairing metadata` 的短期映射。
4. Host 管理页展示二维码，二维码内容只包含：

```text
<PUBLIC_WEB_BASE_URL>/pair/<pairCode>
```

5. 手机扫码打开 Web。
6. Web 通过 `pairCode` 向 Signal 拉取完整 pairing offer；未配对前不要求手机能直连 Host HTTP。
7. Web 生成或读取本机 client keypair，提交配对请求。
8. Host 管理页显示待批准设备，Host 接受后建立信任关系。
9. Web 建立 WebRTC DataChannel，并进入 P2P 模式。

`pairCode` 不等于长期凭证，只是短期索引。过期、已使用或被撤销后必须失效。

## 设备身份和展示名

设备内部仍保留稳定 ID：

- `deviceId`：Host 信任设备记录的主键。
- `clientId`：客户端本地稳定 ID。
- `publicKeyFingerprint`：客户端公钥指纹。

展示名不再使用 `client-<hex>`。首次绑定时 Web 自动生成友好名称：

- 浏览器平台：`Chrome on Android`、`Safari on iOS`、`Edge on Windows`。
- 无法识别时：`CodeRelay Web 设备`。

Host 接受绑定后保存 `displayName`。Host 管理页支持重命名。

设备列表展示字段：

- 设备名称。
- 最近使用时间。
- 当前状态：在线、离线、已撤销。
- 最近连接类型：HTTP、P2P direct、P2P TURN relay。
- 公钥指纹短显示。
- 操作：重命名、撤销、查看诊断。

内部 ID 只在“诊断详情”中显示。

## 撤销语义

Host 撤销设备是即时安全动作：

1. Host 将设备标记为 revoked。
2. 如果设备在线，Host 通过 DataChannel 或 Signal 控制消息发送 `device_revoked`。
3. Host 主动关闭该设备的 P2P 连接。
4. Web 清理当前 trusted host 状态，进入重新授权引导。
5. 后续自动恢复 P2P 时，Host 拒绝 revoked 设备的 challenge。

Web 文案应明确：

```text
此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。
```

## P2P 拓扑与诊断

Host 管理页需要提供可理解的链路状态：

- Signal：已连接 / 断开 / 地址错误。
- TURN：未配置 / 已配置 / 连接测试失败 / 正在使用中。
- 当前 P2P peers：设备名、连接状态、ICE candidate 类型、RTT 或最近心跳。
- 链路类型：直连、TURN relay、HTTP。

第一阶段不要求复杂图形拓扑，可用表格和状态标签表达。关键是让用户知道“现在是否真在走 P2P”“是否经过 TURN 中继”“为什么失败”。

## TURN 中继边界

当前阶段只支持标准 TURN/coturn：

- Signal 下发 `iceServers`。
- WebRTC ICE 自动选择 direct 或 relay candidate。
- DataChannel 业务协议不感知 TURN。
- Host/Web 只展示当前链路是否使用 relay。

不实现 `apps/transit` 自研 WebSocket 中继。原因：

- 自研 Transit 会变成业务流量代理，需要额外鉴权、限流、日志、流量成本和滥用防护。
- WebRTC 已经有成熟 TURN 体系，优先接入标准方案更稳。
- Transit 后续可作为独立 spec 设计，不阻塞当前 P2P 可用性。

## 安全策略

- 二维码不包含私钥。
- `pairCode` 和 `pairingSecret` 短期有效，过期即失效。
- 配对仍需要 Host 接受。
- 设备信任基于客户端公钥。
- 自动恢复必须通过 Host challenge，不能只凭本地缓存。
- revoked 设备不能自动恢复。
- `bypassPermissions` 属于高风险会话模式，Host 管理页和 Web 都要显式标注。

## 文档与配置

需要同步更新：

- `AGENTS.md` / 项目说明中的 P2P 配置项。
- README 或启动脚本说明中的 `PUBLIC_WEB_BASE_URL`、`PUBLIC_SIGNAL_URL`。
- 现有 P2P 设计文档中关于 Transit 的表述，明确当前阶段是 TURN，不是自研 Transit。
- Host 管理页使用说明：如何生成二维码、撤销设备、查看链路类型。

## 测试策略

必须按 TDD 实现。建议测试顺序：

1. Host 单元测试：Host 管理 API 默认不要求 `AUTH_TOKEN`。
2. Host 单元测试：创建配对返回短链接二维码，不再把完整 offer 塞进二维码。
3. Host 单元测试：环境变量默认值和管理页覆盖值合并正确。
4. Host 单元测试：设备展示名优先使用 `displayName`，内部 ID 只在诊断字段出现。
5. Host 单元测试：撤销设备会标记 revoked 并关闭在线 peer。
6. Signal 单元测试：`pairCode` 能路由到有效 pairing，上线/过期/已使用行为正确。
7. Web 单元测试：`/pair/:pairCode` 页面能拉取 offer 并进入配对流程。
8. Web 单元测试：收到 `device_revoked` 后清理信任状态并显示重新授权提示。
9. E2E：Host 生成二维码短链接，手机/Web 打开短链接完成配对。
10. E2E：配置 TURN 后可看到 relay 状态；不配置自研 Transit。

## 验收标准

- Host `/host` 页面能生成可扫描的短链接二维码。
- 二维码内容不再包含完整 offer。
- 设备管理页显示友好设备名、最近使用时间、连接类型和撤销按钮。
- 撤销设备后，P2P 页面立即断开并提示重新授权。
- 后续重新打开 Web 可以通过已信任设备自动恢复；已撤销设备不能恢复。
- Signal + TURN 能完成中继配置下发；仓库不新增自研 Transit 服务。
