export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
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

export interface SearchResult {
  sessionId: string;
  projectId: string;
  title: string;
  matches: Array<{
    message: Message;
    snippet: string;
  }>;
}
