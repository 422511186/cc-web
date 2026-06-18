import { describe, it, expect } from 'vitest';
import { parseJsonl } from './jsonl.js';

describe('parseJsonl', () => {
  it('should parse user messages with message.content', () => {
    const jsonl = `{"type":"user","message":{"content":"Hello"},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello');
    expect(messages[0].timestamp).toBeGreaterThan(0);
  });

  it('should parse assistant messages with content array', () => {
    const jsonl = `{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}],"model":"claude-opus-4-8"},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('Hi there');
    expect(messages[0].model).toBe('claude-opus-4-8');
  });

  it('should parse thinking blocks as separate messages', () => {
    const jsonl = `{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Let me think"},{"type":"text","text":"Final answer"}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('thinking');
    expect(messages[0].content).toBe('Let me think');
    expect(messages[1].type).toBe('text');
    expect(messages[1].content).toBe('Final answer');
  });

  it('should parse multiple messages', () => {
    const jsonl = `{"type":"user","message":{"content":"Q1"},"timestamp":"2026-06-11T17:45:31.574Z"}
{"type":"assistant","message":{"content":[{"type":"text","text":"A1"}]},"timestamp":"2026-06-11T17:45:32.574Z"}
{"type":"user","message":{"content":"Q2"},"timestamp":"2026-06-11T17:45:33.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('Q1');
    expect(messages[1].content).toBe('A1');
    expect(messages[2].content).toBe('Q2');
  });

  it('should skip noise types', () => {
    const jsonl = `{"type":"mode","mode":"normal"}
{"type":"permission-mode","permissionMode":"default"}
{"type":"file-history-snapshot","snapshot":{}}
{"type":"attachment","data":{}}
{"type":"user","message":{"content":"Real message"},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Real message');
  });

  it('P2-B6: 应正确解析 Windows CRLF 换行符的 JSONL', () => {
    const jsonl = '{"type":"user","message":{"content":"Line1"},"timestamp":"2026-06-11T17:45:31.574Z"}\r\n{"type":"assistant","message":{"content":[{"type":"text","text":"Line2"}]},"timestamp":"2026-06-11T17:45:32.574Z"}\r\n';
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Line1');
    expect(messages[1].content).toBe('Line2');
  });

  it('should handle malformed lines gracefully', () => {
    const jsonl = `{"type":"user","message":{"content":"Good"},"timestamp":"2026-06-11T17:45:31.574Z"}
not valid json
{"type":"assistant","message":{"content":[{"type":"text","text":"Also good"}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Good');
    expect(messages[1].content).toBe('Also good');
  });

  it('should handle empty content', () => {
    const jsonl = `{"type":"user","timestamp":"2026-06-11T17:45:31.574Z"}
{"type":"assistant","message":{},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(0);
  });

  it('should extract [Image: source: <path>] markers into metadata.imagePaths', () => {
    const jsonl = `{"type":"user","message":{"content":[{"type":"text","text":"check this [Image: source: C:\\\\Users\\\\me\\\\.claude\\\\image-cache\\\\abc\\\\1.png]"}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].metadata?.imagePaths).toEqual([
      'C:\\Users\\me\\.claude\\image-cache\\abc\\1.png',
    ]);
    // The marker text is stripped from the visible content
    expect(messages[0].content).toBe('check this');
  });

  it('should keep a message that is only an image marker (no leftover text)', () => {
    const jsonl = `{"type":"user","message":{"content":[{"type":"text","text":"[Image: source: /home/me/.claude/image-cache/x/2.png]"}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('');
    expect(messages[0].metadata?.imagePaths).toEqual([
      '/home/me/.claude/image-cache/x/2.png',
    ]);
  });

  it('should extract multiple image markers from one message', () => {
    const jsonl = `{"type":"user","message":{"content":[{"type":"text","text":"a [Image: source: /p/1.png] b [Image: source: /p/2.png]"}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(1);
    expect(messages[0].metadata?.imagePaths).toEqual(['/p/1.png', '/p/2.png']);
  });

  it('should handle Windows CRLF line endings without leaving \\r residue', () => {
    // CRLF (\r\n) 换行符 - 验证 \r 不会干扰 JSON.parse
    const jsonl = `{"type":"user","message":{"content":"First"},"timestamp":"2026-06-11T17:45:31.574Z"}\r\n{"type":"assistant","message":{"content":[{"type":"text","text":"Second"}]},"timestamp":"2026-06-11T17:45:32.574Z"}`;

    // split('\n') 会把每行末尾的 \r 留在字符串里
    // 当前实现: line.trim() 会移除 \r，但这依赖 trim() 行为
    // 更健壮的方式: split(/\r?\n/) 直接处理两种换行符
    const messages = parseJsonl(jsonl);

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
  });
});
