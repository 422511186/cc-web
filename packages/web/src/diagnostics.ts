export type ClientLogDetail = Record<string, unknown>;

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clientLog(event: string, detail: ClientLogDetail = {}): void {
  const payload = {
    event,
    ...detail,
    ts: Date.now(),
  };

  console.debug("[cc-web:client]", payload);

  try {
    void fetch("/api/debug/client-log", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // 诊断日志不能影响主流程
    });
  } catch {
    // 诊断日志不能影响主流程
  }
}
