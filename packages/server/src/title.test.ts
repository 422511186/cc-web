import { describe, it, expect } from 'vitest';
import { extractTitle } from './title.js';

describe('extractTitle', () => {
  it('should extract title from first user message', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello, how are you?', timestamp: 123 },
      { role: 'assistant' as const, content: 'I am fine', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('Hello, how are you?');
  });

  it('should truncate long titles to 50 characters', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'This is a very long message that exceeds fifty characters and should be truncated',
        timestamp: 123,
      },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('This is a very long message that exceeds fifty cha...');
    expect(title.length).toBe(53); // 50 + '...'
  });

  it('should return default title when no user messages exist', () => {
    const messages = [
      { role: 'assistant' as const, content: 'Hello', timestamp: 123 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('Untitled Conversation');
  });

  it('should return default title for empty messages array', () => {
    const title = extractTitle([]);
    expect(title).toBe('Untitled Conversation');
  });

  it('should skip non-user messages and find first user message', () => {
    const messages = [
      { role: 'assistant' as const, content: 'Welcome', timestamp: 122 },
      { role: 'system' as const, content: 'System', timestamp: 123 },
      { role: 'user' as const, content: 'My question', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('My question');
  });

  it('should handle messages with only whitespace', () => {
    const messages = [
      { role: 'user' as const, content: '   \n\t  ', timestamp: 123 },
      { role: 'user' as const, content: 'Real message', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('Real message');
  });

  it('should skip slash command messages', () => {
    const messages = [
      { role: 'user' as const, content: '/effort', timestamp: 123 },
      { role: 'user' as const, content: '/rename new-name', timestamp: 124 },
      { role: 'user' as const, content: '真正的问题', timestamp: 125 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('真正的问题');
  });

  it('should skip local-command-caveat messages', () => {
    const messages = [
      {
        role: 'user' as const,
        content: '<local-command-caveat>Caveat: The messages below were generated</local-command-caveat>',
        timestamp: 123,
      },
      { role: 'user' as const, content: '帮我写个函数', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('帮我写个函数');
  });

  it('should skip command-message / command-name system messages', () => {
    const messages = [
      {
        role: 'user' as const,
        content: '<command-message>effort is running</command-message><command-name>/effort</command-name>',
        timestamp: 123,
      },
      { role: 'user' as const, content: 'How do I deploy this?', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('How do I deploy this?');
  });

  it('should skip system-reminder messages', () => {
    const messages = [
      {
        role: 'user' as const,
        content: '<system-reminder>This is a reminder injected by the system</system-reminder>',
        timestamp: 123,
      },
      { role: 'user' as const, content: '继续刚才的任务', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('继续刚才的任务');
  });

  it('should strip leading absolute path token from resume boilerplate', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'C:\\Users\\huang\\workspace\\cc-web-develop\\temp\\111.md 继续这个会话',
        timestamp: 123,
      },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('继续这个会话');
  });

  it('should strip leading unix path token from resume boilerplate', () => {
    const messages = [
      {
        role: 'user' as const,
        content: '/home/user/project/notes.md 总结一下这个文件',
        timestamp: 123,
      },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('总结一下这个文件');
  });

  it('should continue to next message when stripping path leaves nothing', () => {
    const messages = [
      {
        role: 'user' as const,
        content: 'C:\\Users\\huang\\workspace\\cc-web-develop\\temp\\111.md',
        timestamp: 123,
      },
      { role: 'user' as const, content: '这是真正的问题', timestamp: 124 },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('这是真正的问题');
  });

  it('should return default title when all messages are noise', () => {
    const messages = [
      { role: 'user' as const, content: '/effort', timestamp: 123 },
      {
        role: 'user' as const,
        content: '<system-reminder>noise</system-reminder>',
        timestamp: 124,
      },
    ];

    const title = extractTitle(messages);
    expect(title).toBe('Untitled Conversation');
  });
});
