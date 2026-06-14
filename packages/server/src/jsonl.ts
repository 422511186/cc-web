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
        let messageType: 'text' | 'tool_result' | 'system_message' = 'text';
        let metadata: any = undefined;
        const images: any[] = [];
        const documents: any[] = [];

        if (typeof parsed.message.content === 'string') {
          content = parsed.message.content;

          // Check if it's a system message
          if (content.includes('<command-message>') ||
              content.includes('<local-command-caveat>') ||
              content.includes('<command-name>') ||
              content.includes('<system-reminder>')) {
            messageType = 'system_message';
          }
        } else if (Array.isArray(parsed.message.content)) {
          // message.content can be an array (e.g., tool_result, images, documents)
          const textParts: string[] = [];
          let hasToolResult = false;

          for (const item of parsed.message.content) {
            if (typeof item === 'string') {
              textParts.push(item);
            } else if (typeof item === 'object') {
              if (item.type === 'text' && item.text) {
                textParts.push(item.text);
              } else if (item.type === 'tool_result') {
                hasToolResult = true;
                messageType = 'tool_result';
                textParts.push(item.content || JSON.stringify(item));
                metadata = {
                  toolName: 'tool',
                  toolOutput: item.content,
                  isError: item.is_error || false,
                };
              } else if (item.type === 'image') {
                images.push(item);
              } else if (item.type === 'document') {
                documents.push(item);
              }
            }
          }

          if (textParts.length === 0 && images.length === 0 && documents.length === 0) {
            // No content, skip this message
            continue;
          }
          content = textParts.join('\n\n');
        } else {
          content = JSON.stringify(parsed.message.content);
        }

        // Add images and documents to metadata
        if (images.length > 0 || documents.length > 0) {
          if (!metadata) metadata = {};
          if (images.length > 0) metadata.images = images;
          if (documents.length > 0) metadata.documents = documents;
        }

        messages.push({
          role: 'user',
          content,
          timestamp: parseTimestamp(parsed.timestamp),
          model: parsed.message.model,
          type: messageType,
          metadata,
        });
        continue;
      }

      // Handle assistant messages: type="assistant" with message.content array
      if (parsed.type === 'assistant' && parsed.message?.content) {
        const contentArray = Array.isArray(parsed.message.content)
          ? parsed.message.content
          : [parsed.message.content];

        // Process each content block separately to preserve thinking/tool_use
        for (const item of contentArray) {
          if (typeof item !== 'object') continue;

          // Text blocks
          if (item.type === 'text' && item.text) {
            messages.push({
              role: 'assistant',
              content: item.text,
              timestamp: parseTimestamp(parsed.timestamp),
              model: parsed.message.model,
              type: 'text',
            });
          }

          // Thinking blocks
          if (item.type === 'thinking' && item.thinking) {
            messages.push({
              role: 'assistant',
              content: item.thinking,
              timestamp: parseTimestamp(parsed.timestamp),
              model: parsed.message.model,
              type: 'thinking',
            });
          }

          // Tool use blocks
          if (item.type === 'tool_use' && item.name) {
            messages.push({
              role: 'assistant',
              content: `Tool: ${item.name}`,
              timestamp: parseTimestamp(parsed.timestamp),
              model: parsed.message.model,
              type: 'tool_use',
              metadata: {
                toolName: item.name,
                toolInput: item.input,
              },
            });
          }
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
