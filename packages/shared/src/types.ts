export interface Message {
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
    images?: Array<{
      source: {
        type: string;
        media_type: string;
        data: string;
      };
    }>;
    documents?: Array<{
      type: string;
      source?: {
        type: string;
        media_type: string;
        data: string;
      };
    }>;
    /** Local file paths referenced via "[Image: source: <path>]" markers in the JSONL. */
    imagePaths?: string[];
  };
}

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionDetail extends Session {
  messages: Message[];
}

export interface ActiveAgent {
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
}

export interface SearchResult {
  sessionId: string;
  projectId: string;
  title: string;
  matches: Array<{
    message: Message;
    snippet: string;
  }>;
}
