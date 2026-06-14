import type {
  ProjectsResponse,
  SessionsResponse,
  SessionDetailResponse,
  SearchResponse,
} from '@cc-web/shared';

const API_BASE = '/api';

class ApiClient {
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
}

export function createApiClient(token: string): ApiClient {
  return new ApiClient(token);
}

export type { ApiClient };
