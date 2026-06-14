import type { SearchResult } from '@cc-web/shared';
import type { SessionStore } from './store.js';

const SNIPPET_LENGTH = 100;
const CONTEXT_CHARS = 50;

export async function searchSessions(
  store: SessionStore,
  query: string
): Promise<SearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  const projects = await store.listProjects();

  for (const project of projects) {
    const sessions = await store.listSessions(project.id);

    for (const session of sessions) {
      const detail = await store.getSession(project.id, session.id);

      if (!detail) continue;

      const matches: SearchResult['matches'] = [];

      for (const message of detail.messages) {
        const lowerContent = message.content.toLowerCase();

        if (lowerContent.includes(lowerQuery)) {
          const snippet = createSnippet(message.content, lowerQuery);

          matches.push({
            message,
            snippet,
          });
        }
      }

      if (matches.length > 0) {
        results.push({
          sessionId: session.id,
          projectId: project.id,
          title: session.title,
          matches,
        });
      }
    }
  }

  return results;
}

function createSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);

  if (index === -1) {
    return content.slice(0, SNIPPET_LENGTH) + (content.length > SNIPPET_LENGTH ? '...' : '');
  }

  const start = Math.max(0, index - CONTEXT_CHARS);
  const end = Math.min(content.length, index + query.length + CONTEXT_CHARS);

  let snippet = content.slice(start, end);

  if (start > 0) {
    snippet = '...' + snippet;
  }

  if (end < content.length) {
    snippet = snippet + '...';
  }

  return snippet;
}
