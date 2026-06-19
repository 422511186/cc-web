import type {
  ActiveAgentsResponse,
  SessionHeartbeatResponse,
  StartSessionResponse,
  SendMessageRequest,
  PromptAnswer,
  UploadResponse,
} from "@coderelay/shared";
import { HttpTransport, TransportError, type CodeRelayTransport } from "@coderelay/transport";
import { getHttpApiBase } from "./apiBase";

let chatTransport: CodeRelayTransport | null = null;

export function setChatTransport(transport: CodeRelayTransport | null): void {
  chatTransport = transport;
}

function activeTransport(): CodeRelayTransport {
  return (
    chatTransport ??
    new HttpTransport({
      baseUrl: getHttpApiBase(),
      getAuthToken: () => sessionStorage.getItem("authToken"),
    })
  );
}

/** 新建对话,返回 runId */
export async function startNew(cwd?: string): Promise<string> {
  const body = cwd ? { cwd } : {};
  const response = await activeTransport().request<StartSessionResponse, typeof body>({
    method: "POST",
    path: "/sessions/new",
    body,
  });
  return response.runId;
}

/** 续聊已有 session,返回 runId。projectId 用于后端定位 session 真实项目目录 */
export async function startContinue(
  sessionId: string,
  projectId?: string
): Promise<string> {
  const response = await activeTransport().request<StartSessionResponse, { projectId?: string }>({
    method: "POST",
    path: `/sessions/${encodeURIComponent(sessionId)}/continue`,
    body: { projectId },
  });
  return response.runId;
}

/** 快速探测一个 run 是否仍在后端活跃池中，供前端恢复旧连接前先判活。 */
export async function probeRun(runId: string): Promise<boolean> {
  try {
    await activeTransport().request<unknown>({
      method: "GET",
      path: `/sessions/${encodeURIComponent(runId)}`,
    });
    return true;
  } catch (error) {
    if (error instanceof TransportError && error.status === 404) return false;
    throw error;
  }
}

export async function listActiveAgents(): Promise<ActiveAgentsResponse> {
  return activeTransport().request<ActiveAgentsResponse>({
    method: "GET",
    path: "/sessions/active",
  });
}

export async function closeAgent(runId: string): Promise<void> {
  await activeTransport().request<void>({
    method: "POST",
    path: `/sessions/${encodeURIComponent(runId)}/close`,
  });
}

export async function heartbeatSession(runId: string): Promise<SessionHeartbeatResponse> {
  try {
    return await activeTransport().request<SessionHeartbeatResponse>({
      method: "POST",
      path: `/sessions/${encodeURIComponent(runId)}/heartbeat`,
    });
  } catch (error) {
    if (error instanceof TransportError) {
      const enriched = error as Error & { status?: number };
      enriched.status = error.status;
      throw enriched;
    }
    throw error;
  }
}

/** 发一条用户消息 */
export async function sendMessage(
  runId: string,
  req: SendMessageRequest
): Promise<void> {
  await activeTransport().request<void, SendMessageRequest>({
    method: "POST",
    path: `/sessions/${encodeURIComponent(runId)}/message`,
    body: req,
  });
}

/** 提交对待答事项的回答 */
export async function respond(
  runId: string,
  answer: PromptAnswer
): Promise<void> {
  const body = await activeTransport().request<{ ok?: boolean }, PromptAnswer>({
    method: "POST",
    path: `/sessions/${encodeURIComponent(runId)}/respond`,
    body: answer,
  });
  if (!body.ok) {
    throw new Error("pending prompt is no longer active");
  }
}

/** 优雅分离会话(切换会话/关闭页面)。后台正在执行的任务不会被中断,会跑完后自然回收。
 * 尽力而为:失败静默,不打断切换。keepalive 让请求在页面卸载时仍能发出。 */
export async function closeSession(runId: string): Promise<void> {
  try {
    await activeTransport().request<void>({
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(runId)}`,
      keepalive: true,
    });
  } catch {
    /* 关闭是尽力而为,忽略网络错误 */
  }
}

/** 强制终止会话执行(用户点击停止按钮) */
export async function abortSession(runId: string): Promise<void> {
  try {
    await activeTransport().request<void>({
      method: "POST",
      path: `/sessions/${encodeURIComponent(runId)}/abort`,
    });
  } catch (error) {
    if (error instanceof TransportError) {
      throw new Error(`abortSession failed: ${error.status}`);
    }
    throw error;
  }
}

/** 上传一个文件,返回引用 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return activeTransport().request<UploadResponse, FormData>({
    method: "POST",
    path: "/uploads",
    body: form,
  });
}
