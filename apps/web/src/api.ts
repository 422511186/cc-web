import type {
  ProjectsResponse,
  SessionsResponse,
  SessionDetailResponse,
  SearchResponse,
} from '@coderelay/shared';
import { HttpTransport, type CodeRelayTransport, type TransportStream } from '@coderelay/transport';

const API_BASE = '/api';

interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
}

class ApiClient {
  private stream: TransportStream | null = null;
  private transport: CodeRelayTransport;

  constructor(
    private token: string,
    private onUnauthorized?: () => void,
    transport?: CodeRelayTransport,
  ) {
    this.transport =
      transport ??
      new HttpTransport({
        baseUrl: API_BASE,
        getAuthToken: () => this.token,
        onUnauthorized: this.onUnauthorized,
      });
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = Object.fromEntries(new Headers(options.headers).entries());
    const request = {
      method: options.method ?? 'GET',
      path,
    } as {
      method: string;
      path: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
      keepalive?: boolean;
    };
    if (Object.keys(headers).length > 0) request.headers = headers;
    if (options.body !== undefined && options.body !== null) request.body = options.body;
    if (options.keepalive !== undefined) request.keepalive = options.keepalive;
    return this.transport.request<T>(request);
  }

  async listProjects(): Promise<ProjectsResponse> {
    return this.request<ProjectsResponse>('/projects');
  }

  async listSessions(projectId: string): Promise<SessionsResponse> {
    return this.request<SessionsResponse>(`/projects/${projectId}/sessions`);
  }

  async getSession(projectId: string, sessionId: string): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(
      `/sessions/${sessionId}?projectId=${encodeURIComponent(projectId)}`
    );
  }

  async search(query: string): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      `/search?q=${encodeURIComponent(query)}`
    );
  }

  /** 删除一条历史会话(对标 VSCode 插件的删除功能)。 */
  async deleteSession(projectId: string, sessionId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(
      `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' }
    );
  }

  /** Build a URL for a cached image file, with the auth token as a query param
   * (since <img src> can't send an Authorization header). */
  imageUrl(filePath: string): string {
    return `${API_BASE}/image?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(this.token)}`;
  }

  connectSSE(onSessionUpdate: (update: SSESessionUpdate) => void): () => void {
    // Close existing connection if any
    this.disconnect();
    this.stream = this.transport.subscribe<SSESessionUpdate>({
      path: '/events',
      eventName: 'session-update',
      onEvent: onSessionUpdate,
    });

    // Return cleanup function
    return () => {
      this.disconnect();
    };
  }

  disconnect(): void {
    this.stream?.close();
    this.stream = null;
  }
}

export function createApiClient(
  token: string,
  onUnauthorized?: () => void,
  transport?: CodeRelayTransport,
): ApiClient {
  return new ApiClient(token, onUnauthorized, transport);
}

export type { ApiClient };
