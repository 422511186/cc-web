import type {
  ActiveAgentsResponse,
  SessionHeartbeatResponse,
  StartSessionResponse,
  SendMessageRequest,
  PromptAnswer,
  UploadResponse,
} from "@coderelay/shared";

/** 从 sessionStorage 读 token,拼成鉴权 header(与 App 登录态一致) */
function authHeaders(): Record<string, string> {
  const t = sessionStorage.getItem("authToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 新建对话,返回 runId */
export async function startNew(cwd?: string): Promise<string> {
  const res = await fetch("/api/sessions/new", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(cwd ? { cwd } : {}),
  });
  if (!res.ok) throw new Error(`startNew failed: ${res.status}`);
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 续聊已有 session,返回 runId。projectId 用于后端定位 session 真实项目目录 */
export async function startContinue(
  sessionId: string,
  projectId?: string
): Promise<string> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/continue`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }
  );
  if (!res.ok) {
    // 原项目目录已删除等情况后端返回 409 + 友好 error,透传给用户
    const msg = await res
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new Error(msg ?? `startContinue failed: ${res.status}`);
  }
  const body = (await res.json()) as StartSessionResponse;
  return body.runId;
}

/** 快速探测一个 run 是否仍在后端活跃池中，供前端恢复旧连接前先判活。 */
export async function probeRun(runId: string): Promise<boolean> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}`, {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`probeRun failed: ${res.status}`);
  return true;
}

export async function listActiveAgents(): Promise<ActiveAgentsResponse> {
  const res = await fetch("/api/sessions/active", {
    method: "GET",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`listActiveAgents failed: ${res.status}`);
  return (await res.json()) as ActiveAgentsResponse;
}

export async function closeAgent(runId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/close`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`closeAgent failed: ${res.status}`);
}

export async function heartbeatSession(runId: string): Promise<SessionHeartbeatResponse> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/heartbeat`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const error = new Error(`heartbeatSession failed: ${res.status}`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return (await res.json()) as SessionHeartbeatResponse;
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
  const body = (await res.json()) as { ok?: boolean };
  if (!body.ok) {
    throw new Error("pending prompt is no longer active");
  }
}

/** 优雅分离会话(切换会话/关闭页面)。后台正在执行的任务不会被中断,会跑完后自然回收。
 * 尽力而为:失败静默,不打断切换。keepalive 让请求在页面卸载时仍能发出。 */
export async function closeSession(runId: string): Promise<void> {
  try {
    await fetch(`/api/sessions/${encodeURIComponent(runId)}`, {
      method: "DELETE",
      headers: { ...authHeaders() },
      keepalive: true,
    });
  } catch {
    /* 关闭是尽力而为,忽略网络错误 */
  }
}

/** 强制终止会话执行(用户点击停止按钮) */
export async function abortSession(runId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(runId)}/abort`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`abortSession failed: ${res.status}`);
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
