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
    projectId: string;
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
    messageCount: number;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: number;
      model?: string;
      type?: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'system_message';
      metadata?: {
        toolName?: string;
        toolInput?: any;
        toolOutput?: any;
        isError?: boolean;
      };
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

export interface NewSessionRequest {
  cwd?: string;
}

export interface NewSessionResponse {
  runId: string;
}

export interface ActiveAgentsResponse {
  agents: Array<{
    runId: string;
    kind: 'new' | 'continue';
    sessionId: string | null;
    projectId?: string;
    cwd?: string;
    status: 'idle' | 'executing' | 'waiting';
    createdAt: number;
    lastEventAt: number;
    attached: boolean;
    lastHeartbeatAt: number | null;
    leaseExpiresAt: number | null;
  }>;
  maxConcurrent: number;
}

export interface SessionHeartbeatResponse {
  ok: boolean;
  runId: string;
  status: 'idle' | 'executing' | 'waiting';
  attached: boolean;
  lastHeartbeatAt: number;
  leaseExpiresAt: number;
}
