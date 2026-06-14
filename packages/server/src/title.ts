import type { Message } from '@cc-web/shared';

const MAX_TITLE_LENGTH = 50;
const DEFAULT_TITLE = 'Untitled Conversation';

export function extractTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(
    msg => msg.role === 'user' && msg.content.trim()
  );

  if (!firstUserMessage) {
    return DEFAULT_TITLE;
  }

  const content = firstUserMessage.content.trim();

  if (content.length <= MAX_TITLE_LENGTH) {
    return content;
  }

  return content.slice(0, MAX_TITLE_LENGTH) + '...';
}
