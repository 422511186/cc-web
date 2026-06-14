import type {
  StartSessionResponse,
  SendMessageRequest,
  PromptAnswer,
  UploadResponse,
} from "@cc-web/shared";

/** 从 sessionStorage 读 token,拼成鉴权 header(与 App 登录态一致) */
function authHeaders(): Record<string, string> {
  const t = sessionStorage.getItem("authToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 新建对话,返回 runId */
export async function startNew(): Promise<string> {
  const res = await fetch("/api/sessions/new", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`startNew failed: ${res.status}`);
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 续聊已有 session,返回 runId */
export async function startContinue(sessionId: string): Promise<string> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/continue`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "{}",
    }
  );
  if (!res.ok) throw new Error(`startContinue failed: ${res.status}`);
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 发一条用户消息 */
export async function sendMessage(
  runId: string,
  req: SendMessageRequest
): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/message`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`);
}

/** 提交对待答事项的回答 */
export async function respond(
  runId: string,
  answer: PromptAnswer
): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/respond`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
  if (!res.ok) throw new Error(`respond failed: ${res.status}`);
}

/** 上传一个文件,返回引用 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { ...authHeaders() }, // 不要手动设 Content-Type,浏览器会带 boundary
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()) as UploadResponse;
}
