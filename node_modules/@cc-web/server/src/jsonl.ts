import type { Message } from '@cc-web/shared';

interface JsonlLine {
  type?: string;
  text?: string;
  timestamp?: string | number;
  model?: string;
  message?: {
    role?: string;
    content?: string | any[];
    model?: string;
  };
}

const NOISE_TYPES = new Set([
  'system',
  'mode',
  'permission-mode',
  'file-history-snapshot',
  'last-prompt',
  'attachment',
]);

export function parseJsonl(content: string): Message[] {
  const lines = content.split('\n').filter(line => line.trim());
  const messages: Message[] = [];

  for (const line of lines) {
    try {
      const parsed: JsonlLine = JSON.parse(line);

      // Skip noise types
      if (!parsed.type || NOISE_TYPES.has(parsed.type)) {
        continue;
      }

      // Handle user messages: type="user" with message.content
      if (parsed.type === 'user' && parsed.message?.content) {
        let content: string;

        if (typeof parsed.message.content === 'string') {
          content = parsed.message.content;
        } else if (Array.isArray(parsed.message.content)) {
          // message.content can be an array (e.g., tool_result)
          // Skip tool-related messages, only extract text
          const textParts: string[] = [];
          for (const item of parsed.message.content) {
            if (typeof item === 'string') {
              textParts.push(item);
            } else if (typeof item === 'object' && item.type === 'text' && item.text) {
              textParts.push(item.text);
            }
            // Skip tool_result, tool_use, and other non-text types
          }

          if (textParts.length === 0) {
            // No actual user text, skip this message
            continue;
          }
          content = textParts.join('\n\n');
        } else {
          content = JSON.stringify(parsed.message.content);
        }

        messages.push({
          role: 'user',
          content,
          timestamp: parseTimestamp(parsed.timestamp),
          model: parsed.message.model,
        });
        continue;
      }

      // Handle assistant messages: type="assistant" with message.content array
      if (parsed.type === 'assistant' && parsed.message?.content) {
        const contentArray = Array.isArray(parsed.message.content)
          ? parsed.message.content
          : [parsed.message.content];

        // Extract text from content array
        const textParts: string[] = [];
        for (const item of contentArray) {
          if (typeof item === 'object' && item.type === 'text' && item.text) {
            textParts.push(item.text);
          }
        }

        if (textParts.length > 0) {
          messages.push({
            role: 'assistant',
            content: textParts.join('\n\n'),
            timestamp: parseTimestamp(parsed.timestamp),
            model: parsed.message.model,
          });
        }
        continue;
      }

      // Handle legacy text format: type="text" with text field
      if (parsed.type === 'text' && parsed.text) {
        messages.push({
          role: 'assistant',
          content: parsed.text,
          timestamp: parseTimestamp(parsed.timestamp),
          model: parsed.model,
        });
        continue;
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return messages;
}

function parseTimestamp(ts: string | number | undefined): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}
