export interface AuthRequest {
  token: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
}

export interface ProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    path: string;
  }>;
}

export interface SessionsResponse {
  sessions: Array<{
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }>;
}

export interface SessionDetailResponse {
  session: {
    id: string;
    projectId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: number;
      model?: string;
    }>;
  };
}

export interface SearchResponse {
  results: Array<{
    sessionId: string;
    projectId: string;
    title: string;
    matches: Array<{
      message: {
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp: number;
        model?: string;
      };
      snippet: string;
    }>;
  }>;
}
