import type { Message } from '@cc-web/shared';

const MAX_TITLE_LENGTH = 50;
const DEFAULT_TITLE = 'Untitled Conversation';

// 含这些标记的消息属于命令/系统注入的噪音，应跳过
const NOISE_TAGS = [
  '<command-message>',
  '<command-name>',
  '<local-command-caveat>',
  '<system-reminder>',
];

// 匹配开头的绝对路径 token（Windows 盘符路径或 Unix 多段路径），用于剥离续聊样板。
// Unix 路径要求至少两段（/a/b），以免误伤单 token 的斜杠命令（如 /effort、/rename）。
const LEADING_PATH = /^(?:[a-zA-Z]:\\[^\s]+|\/[^\s/]+(?:\/[^\s/]+)+)(?:\s+|$)/;

/**
 * 将一条 user 消息归一化为可作标题的人类提问；若为噪音或剥离后为空则返回 null。
 */
function toTitleContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  // 先剥掉开头的绝对路径 token（续聊注入样板，如 "<路径> 继续这个会话"）。
  // 放在斜杠命令判断之前，避免 Unix 路径被当成斜杠命令；剥完为空说明是纯路径，视为噪音。
  const stripped = trimmed.replace(LEADING_PATH, '').trim();
  if (!stripped) {
    return null;
  }

  // 跳过斜杠命令（如 /effort、/rename）
  if (stripped.startsWith('/')) {
    return null;
  }

  // 跳过含命令/系统注入标记的消息
  if (NOISE_TAGS.some(tag => stripped.includes(tag))) {
    return null;
  }

  return stripped;
}

export function extractTitle(messages: Message[]): string {
  let content: string | null = null;

  for (const msg of messages) {
    if (msg.role !== 'user') {
      continue;
    }
    const candidate = toTitleContent(msg.content);
    if (candidate) {
      content = candidate;
      break;
    }
  }

  if (!content) {
    return DEFAULT_TITLE;
  }

  if (content.length <= MAX_TITLE_LENGTH) {
    return content;
  }

  return content.slice(0, MAX_TITLE_LENGTH) + '...';
}
