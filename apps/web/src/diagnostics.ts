import { HttpTransport, type CodeRelayTransport } from "@coderelay/transport";

export type ClientLogDetail = Record<string, unknown>;

let diagnosticsTransport: CodeRelayTransport | null = null;

export function setDiagnosticsTransport(transport: CodeRelayTransport | null): void {
  diagnosticsTransport = transport;
}

function activeTransport(): CodeRelayTransport {
  return (
    diagnosticsTransport ??
    new HttpTransport({
      baseUrl: "/api",
      getAuthToken: () => sessionStorage.getItem("authToken"),
    })
  );
}

export function clientLog(event: string, detail: ClientLogDetail = {}): void {
  const payload = {
    event,
    ...detail,
    ts: Date.now(),
  };

  console.debug("[cc-web:client]", payload);

  try {
    void activeTransport().request<void, typeof payload>({
      method: "POST",
      path: "/debug/client-log",
      body: payload,
      keepalive: true,
    }).catch(() => {
      // 诊断日志不能影响主流程
    });
  } catch {
    // 诊断日志不能影响主流程
  }
}
