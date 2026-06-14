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

  it('should skip isMeta messages (internal [Image: source] expansions)', () => {
    // A real user message carrying the pasted image as base64, followed by the
    // internal isMeta expansion that repeats it as an [Image: source] marker.
    const real = `{"type":"user","message":{"content":[{"type":"text","text":"what is this?"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAAA"}}]},"timestamp":"2026-06-11T17:45:31.574Z"}`;
    const meta = `{"type":"user","message":{"content":[{"type":"text","text":"[Image: source: /home/me/.claude/image-cache/x/26.png]"}]},"isMeta":true,"timestamp":"2026-06-11T17:45:32.000Z"}`;
    const messages = parseJsonl(`${real}\n${meta}`);

    // Only the real message survives — the meta duplicate is dropped.
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('what is this?');
    expect(messages[0].metadata?.images).toHaveLength(1);
    expect(messages[0].metadata?.imagePaths).toBeUndefined();
  });
});
