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
      background: #f6f8fa;
      color: #24292f;
    }
    body {
      margin: 0;
      min-height: 100vh;
    }
    main {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 24px 0 40px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 4px;
      letter-spacing: 0;
    }
    h2 {
      font-size: 16px;
      margin: 0 0 12px;
      letter-spacing: 0;
    }
    .muted {
      color: #57606a;
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(280px, 360px) 1fr;
      gap: 16px;
    }
    section {
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 650;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 14px;
    }
    button {
      border: 1px solid #0969da;
      background: #0969da;
      color: #fff;
      border-radius: 6px;
      padding: 9px 12px;
      font-weight: 650;
      cursor: pointer;
    }
    button.secondary {
      background: #fff;
      color: #0969da;
    }
    button.danger {
      border-color: #cf222e;
      background: #fff;
      color: #cf222e;
    }
    button:disabled {
      border-color: #d0d7de;
      background: #eaeef2;
      color: #6e7781;
      cursor: not-allowed;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .stack {
      display: grid;
      gap: 12px;
    }
    .qr {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 232px;
      border: 1px dashed #d0d7de;
      border-radius: 8px;
      background: #f6f8fa;
    }
    .qr img {
      width: 220px;
      height: 220px;
      image-rendering: pixelated;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid #d8dee4;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: #57606a;
      font-weight: 650;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.55;
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 12px;
    }
    .status {
      min-height: 18px;
      font-size: 13px;
      color: #57606a;
    }
    .error {
      color: #cf222e;
    }
    @media (max-width: 760px) {
      header,
      .grid {
        display: grid;
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>CodeRelay Host 管理</h1>
        <div class="muted">电脑端设备配对、密钥撤销和 P2P 链路诊断。</div>
      </div>
      <button id="refresh" class="secondary" type="button">刷新</button>
    </header>
    <div id="status" class="status"></div>

    <div class="grid">
      <section class="stack" aria-label="连接设置">
        <div>
          <h2>连接设置</h2>
          <div class="muted">二维码里的 Web 地址和手机连接 Signal 的地址。</div>
        </div>
        <div>
          <label for="web-url">Web 地址</label>
          <input id="web-url" placeholder="http://172.30.1.102:3100" />
        </div>
        <div>
          <label for="signal-url">Signal 地址</label>
          <input id="signal-url" placeholder="ws://172.30.1.102:3001" />
        </div>
        <div class="row">
          <button id="save-settings" type="button">保存设置</button>
        </div>
      </section>

      <section class="stack" aria-label="添加设备">
        <div class="row" style="justify-content: space-between;">
          <div>
            <h2>添加设备</h2>
            <div class="muted">手机扫码后会打开 CodeRelay Web，并通过 Signal 完成 P2P 配对。</div>
          </div>
          <button id="open-pairing" type="button">生成二维码</button>
        </div>
        <div class="qr" id="qr-box"><span class="muted">尚未生成二维码</span></div>
        <input id="pairing-url" readonly placeholder="配对链接会显示在这里" />
      </section>

      <section aria-label="设备管理">
        <h2>设备管理</h2>
        <table>
          <thead>
            <tr>
              <th>设备</th>
              <th>近期使用</th>
              <th>类型</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="devices">
            <tr><td colspan="5" class="muted">暂无数据</td></tr>
          </tbody>
        </table>
      </section>

      <section aria-label="链路拓扑">
        <h2>P2P 链路拓扑</h2>
        <pre id="topology">暂无数据</pre>
      </section>
    </div>
  </main>
  <script>
    const statusEl = document.querySelector("#status");
    const devicesEl = document.querySelector("#devices");
    const topologyEl = document.querySelector("#topology");
    const qrBox = document.querySelector("#qr-box");
    const pairingUrl = document.querySelector("#pairing-url");
    const webUrlInput = document.querySelector("#web-url");
    const signalUrlInput = document.querySelector("#signal-url");

    function setStatus(message, isError) {
      statusEl.textContent = message || "";
      statusEl.className = isError ? "status error" : "status";
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

    function renderDevices(devices) {
      if (!devices.length) {
        devicesEl.innerHTML = '<tr><td colspan="5" class="muted">暂无已绑定设备</td></tr>';
        return;
      }
      devicesEl.innerHTML = devices.map((device) => {
        const revoked = Boolean(device.revokedAt);
        return '<tr>' +
          '<td><strong>' + escapeHtml(device.displayName || device.clientId) + '</strong><br><span class="muted">' + escapeHtml(device.clientId) + '</span></td>' +
          '<td>' + escapeHtml(formatTime(device.lastUsedAt)) + '</td>' +
          '<td>' + escapeHtml(device.lastTransport || "-") + '</td>' +
          '<td>' + (revoked ? "已撤销" : "可信") + '</td>' +
          '<td><button class="danger" data-client="' + escapeHtml(device.clientId) + '" ' + (revoked ? "disabled" : "") + '>撤销</button></td>' +
          '</tr>';
      }).join("");
    }

    function renderTopology(topology) {
      topologyEl.textContent = JSON.stringify(topology, null, 2);
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
      renderDevices(state.devices || []);
      renderTopology(state.topology || {});
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

    devicesEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-client]");
      if (!button) return;
      const clientId = button.getAttribute("data-client");
      try {
        await request("/api/p2p/devices/" + encodeURIComponent(clientId), { method: "DELETE" });
        setStatus("设备已撤销: " + clientId);
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
