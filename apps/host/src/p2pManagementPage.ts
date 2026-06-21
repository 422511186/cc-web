export function createHostManagementPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodeRelay Host 管理</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f3f5f7;
      color: #1f2937;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f3f5f7;
    }
    button,
    input {
      font: inherit;
    }
    main {
      width: min(1280px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 5px;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    h2 {
      margin: 0;
      font-size: 17px;
      line-height: 1.35;
      letter-spacing: 0;
    }
    h3 {
      margin: 0;
      font-size: 13px;
      line-height: 1.35;
      letter-spacing: 0;
      color: #475569;
    }
    .muted {
      color: #64748b;
      font-size: 13px;
      line-height: 1.55;
    }
    .status-message {
      min-height: 20px;
      margin-bottom: 12px;
      color: #64748b;
      font-size: 13px;
    }
    .error {
      color: #b42318;
    }
    button {
      min-height: 38px;
      border: 1px solid #2563eb;
      background: #2563eb;
      color: #fff;
      border-radius: 7px;
      padding: 8px 13px;
      font-weight: 650;
      cursor: pointer;
      white-space: nowrap;
    }
    button.secondary {
      background: #fff;
      color: #1d4ed8;
      border-color: #bfdbfe;
    }
    button.ghost {
      background: #f8fafc;
      color: #334155;
      border-color: #cbd5e1;
    }
    button.danger {
      border-color: #fecaca;
      background: #fff;
      color: #b42318;
    }
    button:disabled {
      border-color: #d6dee8;
      background: #e7ecf2;
      color: #7a8697;
      cursor: not-allowed;
    }
    .row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      min-width: 0;
    }
    .status-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .status-card,
    .panel,
    .primary-panel {
      min-width: 0;
      background: #fff;
      border: 1px solid #d7dee8;
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .status-card {
      padding: 14px;
      display: grid;
      gap: 8px;
    }
    .status-label {
      color: #64748b;
      font-size: 12px;
      font-weight: 650;
    }
    .status-value {
      color: #111827;
      font-size: 15px;
      font-weight: 720;
      overflow-wrap: anywhere;
    }
    .status-detail {
      color: #64748b;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .status-card[data-tone="good"] {
      border-color: #bbf7d0;
      background: #f7fef9;
    }
    .status-card[data-tone="warn"] {
      border-color: #fde68a;
      background: #fffdf2;
    }
    .status-card[data-tone="bad"] {
      border-color: #fecaca;
      background: #fff8f7;
    }
    .primary-panel {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
      gap: 18px;
      padding: 18px;
      margin-bottom: 16px;
    }
    .panel {
      padding: 18px;
    }
    .panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
      min-width: 0;
    }
    .stack {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    label {
      display: block;
      margin-bottom: 6px;
      color: #334155;
      font-size: 13px;
      font-weight: 650;
    }
    input {
      width: 100%;
      min-width: 0;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      padding: 10px 12px;
      color: #111827;
      background: #fff;
      font-size: 14px;
    }
    input[readonly] {
      background: #f8fafc;
    }
    .pairing-copy {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }
    .pairing-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .qr {
      width: 100%;
      min-height: 272px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      padding: 18px;
    }
    .qr img {
      width: min(240px, 100%);
      aspect-ratio: 1;
      height: auto;
      image-rendering: pixelated;
    }
    .empty-qr {
      max-width: 220px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
      line-height: 1.6;
    }
    .secondary-grid {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 16px;
      margin-bottom: 16px;
    }
    .devices-list {
      display: grid;
      gap: 10px;
      min-width: 0;
    }
    .device-card {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(130px, 0.7fr) minmax(90px, 0.45fr) minmax(90px, 0.45fr) auto;
      gap: 12px;
      align-items: center;
      min-width: 0;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fbfdff;
    }
    .device-name {
      min-width: 0;
      font-weight: 720;
      color: #111827;
      overflow-wrap: anywhere;
    }
    .device-id {
      min-width: 0;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .field-label {
      display: block;
      color: #64748b;
      font-size: 11px;
      font-weight: 650;
      margin-bottom: 3px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 12px;
      font-weight: 700;
      background: #e0f2fe;
      color: #075985;
    }
    .pill.good {
      background: #dcfce7;
      color: #166534;
    }
    .pill.warn {
      background: #fef3c7;
      color: #92400e;
    }
    .pill.bad {
      background: #fee2e2;
      color: #991b1b;
    }
    .empty-state {
      min-height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      color: #64748b;
      font-size: 13px;
      text-align: center;
    }
    .topology-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .topology-field {
      min-width: 0;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fbfdff;
    }
    .topology-value {
      margin-top: 5px;
      color: #111827;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    details {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
      padding: 10px 12px;
    }
    summary {
      cursor: pointer;
      color: #334155;
      font-size: 13px;
      font-weight: 650;
    }
    pre {
      margin: 10px 0 0;
      max-height: 260px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 12px;
      line-height: 1.55;
      color: #334155;
    }
    @media (max-width: 980px) {
      .status-strip,
      .secondary-grid,
      .primary-panel {
        grid-template-columns: 1fr;
      }
      .device-card {
        grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
      }
      .device-action {
        grid-column: 1 / -1;
      }
    }
    @media (max-width: 640px) {
      main {
        width: min(100% - 20px, 1280px);
        padding-top: 18px;
      }
      header,
      .panel-header,
      .pairing-copy {
        display: grid;
        grid-template-columns: 1fr;
      }
      .status-strip,
      .topology-fields,
      .device-card {
        grid-template-columns: 1fr;
      }
      .qr {
        min-height: 220px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>CodeRelay Host 管理</h1>
        <div class="muted">管理手机配对、设备授权和 P2P 链路状态。</div>
      </div>
      <button id="refresh" class="secondary" type="button">刷新</button>
    </header>
    <div id="status" class="status-message"></div>

    <div class="status-strip" aria-label="Host 状态">
      <div class="status-card" id="signal-card">
        <div class="status-label">Signal</div>
        <div class="status-value">检查中</div>
        <div class="status-detail">等待 Host 状态</div>
      </div>
      <div class="status-card" id="peer-card">
        <div class="status-label">P2P</div>
        <div class="status-value">检查中</div>
        <div class="status-detail">等待连接</div>
      </div>
      <div class="status-card" id="turn-card">
        <div class="status-label">TURN</div>
        <div class="status-value">检查中</div>
        <div class="status-detail">中继配置</div>
      </div>
      <div class="status-card" id="device-card">
        <div class="status-label">当前设备</div>
        <div class="status-value">无连接</div>
        <div class="status-detail">暂无活跃客户端</div>
      </div>
    </div>

    <section class="primary-panel" aria-label="添加设备">
      <div class="stack">
        <div class="panel-header">
          <div>
            <h2>添加设备</h2>
            <div class="muted">在手机上扫码打开 CodeRelay Web，完成一次授权后，后续可用密钥自动重连。</div>
          </div>
          <div class="pairing-actions">
            <button id="open-pairing" type="button">生成二维码</button>
          </div>
        </div>
        <div class="pairing-copy">
          <input id="pairing-url" readonly placeholder="生成后这里会出现手机可访问的配对链接" />
          <button id="copy-pairing" class="ghost" type="button">复制链接</button>
        </div>
        <div class="muted">二维码有效期较短；如果手机提示授权过期，请在这里重新生成。</div>
      </div>
      <div class="qr" id="qr-box">
        <div class="empty-qr">尚未生成二维码。点击“生成二维码”后，把手机摄像头对准这里即可。</div>
      </div>
    </section>

    <div class="secondary-grid">
      <section class="panel stack" aria-label="连接设置">
        <div>
          <h2>连接设置</h2>
          <div class="muted">二维码使用的 Web 地址，以及手机连接 Signal 的地址。</div>
        </div>
        <div>
          <label for="web-url">Web 地址</label>
          <input id="web-url" placeholder="http://192.0.2.20:3000" />
        </div>
        <div>
          <label for="signal-url">Signal 地址</label>
          <input id="signal-url" placeholder="ws://192.0.2.20:8787/" />
        </div>
        <div class="row">
          <button id="save-settings" type="button">保存设置</button>
        </div>
      </section>

      <section class="panel stack" aria-label="链路拓扑">
        <div class="panel-header">
          <div>
            <h2>P2P 链路拓扑</h2>
            <div class="muted">当前 Signal、WebRTC 和 Host 本地桥接状态。</div>
          </div>
        </div>
        <div class="topology-fields" id="topology-cards">
          <div class="topology-field">
            <h3>信令服务</h3>
            <div class="topology-value">暂无数据</div>
          </div>
          <div class="topology-field">
            <h3>当前连接</h3>
            <div class="topology-value">暂无数据</div>
          </div>
        </div>
        <details>
          <summary>调试详情</summary>
          <pre id="topology-json">暂无数据</pre>
        </details>
      </section>
    </div>

    <section class="panel" aria-label="设备管理">
      <div class="panel-header">
        <div>
          <h2>设备管理</h2>
          <div class="muted">已授权的手机和浏览器。撤销后该设备需要重新扫码授权。</div>
        </div>
      </div>
      <div class="devices-list" id="devices">
        <div class="empty-state">暂无已绑定设备</div>
      </div>
    </section>
  </main>
  <script>
    const statusEl = document.querySelector("#status");
    const devicesEl = document.querySelector("#devices");
    const topologyCardsEl = document.querySelector("#topology-cards");
    const topologyJsonEl = document.querySelector("#topology-json");
    const qrBox = document.querySelector("#qr-box");
    const pairingUrl = document.querySelector("#pairing-url");
    const webUrlInput = document.querySelector("#web-url");
    const signalUrlInput = document.querySelector("#signal-url");

    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.className = isError ? "status-message error" : "status-message";
    }

    async function request(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options && options.headers ? options.headers : {}),
        },
      });
      if (!response.ok) {
        throw new Error("请求失败: " + response.status);
      }
      return response.json();
    }

    function formatTime(value) {
      return value ? new Date(value).toLocaleString("zh-CN") : "从未";
    }

    function compactId(value) {
      const text = String(value || "");
      if (text.length <= 20) return text || "-";
      return text.slice(0, 12) + "..." + text.slice(-8);
    }

    function transportLabel(value) {
      if (value === "p2p") return "P2P";
      if (value === "http") return "HTTP";
      return value || "-";
    }

    function connectionLabel(value) {
      if (value === "connected") return "已连接";
      if (value === "connecting") return "连接中";
      if (value === "disconnected") return "未连接";
      if (value === "error") return "异常";
      return value || "未知";
    }

    function toneFor(value) {
      if (value === "connected" || value === true) return "good";
      if (value === "connecting") return "warn";
      if (value === "error" || value === "disconnected" || value === false) return "bad";
      return "";
    }

    function setStatusCard(id, value, detail, tone) {
      const card = document.querySelector("#" + id);
      card.dataset.tone = tone || "";
      card.querySelector(".status-value").textContent = value;
      card.querySelector(".status-detail").textContent = detail || "";
    }

    function renderDevices(devices, topology) {
      if (!devices.length) {
        devicesEl.innerHTML = '<div class="empty-state">暂无已绑定设备</div>';
        return;
      }
      const activeClientId = topology && topology.activeConnection ? topology.activeConnection.clientId : "";
      devicesEl.innerHTML = devices.map((device) => {
        const revoked = Boolean(device.revokedAt);
        const isActive = device.clientId === activeClientId;
        const statusText = revoked ? "已撤销" : (isActive ? "在线" : "可信");
        const statusTone = revoked ? "bad" : (isActive ? "good" : "");
        return '<article class="device-card">' +
          '<div class="device-main"><div class="device-name">' + escapeHtml(device.displayName || "未命名设备") + '</div>' +
          '<div class="device-id" title="' + escapeHtml(device.clientId) + '">' + escapeHtml(compactId(device.clientId)) + '</div></div>' +
          '<div><span class="field-label">近期使用</span>' + escapeHtml(formatTime(device.lastUsedAt)) + '</div>' +
          '<div><span class="field-label">类型</span><span class="pill">' + escapeHtml(transportLabel(device.lastTransport)) + '</span></div>' +
          '<div><span class="field-label">状态</span><span class="pill ' + statusTone + '">' + statusText + '</span></div>' +
          '<div class="device-action"><button class="danger" data-client="' + escapeHtml(device.clientId) + '" ' + (revoked ? "disabled" : "") + '>撤销</button></div>' +
          '</article>';
      }).join("");
    }

    function renderTopology(topology) {
      const active = topology.activeConnection || {};
      topologyCardsEl.innerHTML =
        topologyField("信令服务", connectionLabel(topology.signalStatus) + "\\n" + (topology.signalUrl || "-")) +
        topologyField("Host ID", topology.hostId || "-") +
        topologyField("当前连接", active.clientId ? compactId(active.clientId) + "\\n" + (active.route || "WebRTC DataChannel") : "暂无活跃连接") +
        topologyField("本机地址", (topology.iceLocalAddresses || []).join("\\n") || "-") +
        topologyField("TURN 中继", topology.turnConfigured ? "已配置" : "未配置") +
        topologyField("传输类型", active.transport ? transportLabel(active.transport) : connectionLabel(topology.peerStatus));
      topologyJsonEl.textContent = JSON.stringify(topology, null, 2);
      setStatusCard("signal-card", connectionLabel(topology.signalStatus), topology.signalUrl || "-", toneFor(topology.signalStatus));
      setStatusCard("peer-card", connectionLabel(topology.peerStatus), active.route || "等待 WebRTC DataChannel", toneFor(topology.peerStatus));
      setStatusCard("turn-card", topology.turnConfigured ? "已配置" : "未配置", topology.turnConfigured ? "可用作中继兜底" : "当前未使用 TURN", topology.turnConfigured ? "good" : "warn");
      setStatusCard("device-card", active.clientId ? compactId(active.clientId) : "无连接", active.connectionId || "暂无活跃客户端", active.clientId ? "good" : "");
    }

    function topologyField(label, value) {
      return '<div class="topology-field"><h3>' + escapeHtml(label) + '</h3><div class="topology-value">' + escapeHtml(value).replace(/\\n/g, "<br>") + '</div></div>';
    }

    async function refreshSettings() {
      const settings = await request("/api/host/settings");
      webUrlInput.value = settings.webUrl || "";
      signalUrlInput.value = settings.signalUrl || "";
    }

    async function refresh() {
      const [state] = await Promise.all([
        request("/api/p2p/management"),
        refreshSettings(),
      ]);
      const topology = state.topology || {};
      renderDevices(state.devices || [], topology);
      renderTopology(topology);
      setStatus("已刷新");
    }

    document.querySelector("#refresh").addEventListener("click", () => {
      refresh().catch((error) => setStatus(error.message, true));
    });

    document.querySelector("#save-settings").addEventListener("click", async () => {
      try {
        await request("/api/host/settings", {
          method: "PATCH",
          body: JSON.stringify({
            webUrl: webUrlInput.value,
            signalUrl: signalUrlInput.value,
          }),
        });
        setStatus("设置已保存");
        await refresh();
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    document.querySelector("#open-pairing").addEventListener("click", async () => {
      try {
        const pairing = await request("/api/p2p/pairing", { method: "POST", body: "{}" });
        qrBox.innerHTML = '<img alt="配对二维码" src="' + pairing.qrDataUrl + '" />';
        pairingUrl.value = pairing.pairingUrl;
        setStatus("二维码已生成，有效期至 " + formatTime(pairing.offer.expiresAt));
        await refresh();
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    document.querySelector("#copy-pairing").addEventListener("click", async () => {
      if (!pairingUrl.value) {
        setStatus("请先生成二维码", true);
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(pairingUrl.value);
        } else {
          pairingUrl.select();
          document.execCommand("copy");
        }
        setStatus("配对链接已复制");
      } catch (error) {
        setStatus("复制失败，请手动选择链接", true);
      }
    });

    devicesEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-client]");
      if (!button) return;
      const clientId = button.getAttribute("data-client");
      try {
        await request("/api/p2p/devices/" + encodeURIComponent(clientId), { method: "DELETE" });
        setStatus("设备已撤销: " + compactId(clientId));
        await refresh();
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char]));
    }

    refresh().catch((error) => setStatus(error.message, true));
  </script>
</body>
</html>`;
}
