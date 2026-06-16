import type {
  ProjectsResponse,
  SessionsResponse,
  SessionDetailResponse,
  SearchResponse,
} from '@cc-web/shared';

const API_BASE = '/api';

interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
}

class ApiClient {
  private eventSource: EventSource | null = null;

  constructor(private token: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
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
    if (this.eventSource) {
      this.eventSource.close();
    }

    // Create new EventSource with auth token in URL (since EventSource doesn't support custom headers)
    const url = `${API_BASE}/events?token=${encodeURIComponent(this.token)}`;
    console.log('Connecting to SSE:', url);
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log('SSE connection established');
    };

    this.eventSource.addEventListener('session-update', (event) => {
      console.log('Received session-update:', event.data);
      try {
        const data = JSON.parse(event.data) as SSESessionUpdate;
        onSessionUpdate(data);
      } catch (error) {
        console.error('Failed to parse SSE message:', error);
      }
    });

    this.eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      console.log('SSE readyState:', this.eventSource?.readyState);
    };

    // Return cleanup function
    return () => {
      console.log('Closing SSE connection');
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }
}

export function createApiClient(token: string): ApiClient {
  return new ApiClient(token);
}

export type { ApiClient };
