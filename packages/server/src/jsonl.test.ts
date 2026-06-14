import { describe, it, expect, beforeEach } from 'vitest';
import { parseJsonl } from './jsonl.js';
import type { Message } from '@cc-web/shared';

describe('parseJsonl', () => {
  it('should parse valid JSONL with user and assistant messages', () => {
    const input = `{"type":"user","text":"Hello"}
{"type":"assistant","text":"Hi there"}`;

    const messages = parseJsonl(input);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'Hello',
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hi there',
    });
  });

  it('should skip system and noise message types', () => {
    const input = `{"type":"user","text":"Hello"}
{"type":"system","text":"System message"}
{"type":"mode","mode":"default"}
{"type":"permission-mode","mode":"default"}
{"type":"file-history-snapshot","files":[]}
{"type":"last-prompt","text":"foo"}
{"type":"assistant","text":"Response"}`;

    const messages = parseJsonl(input);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('should handle malformed lines gracefully', () => {
    const input = `{"type":"user","text":"Hello"}
invalid json line
{"type":"assistant","text":"Response"}`;

    const messages = parseJsonl(input);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('should handle empty input', () => {
    const messages = parseJsonl('');
    expect(messages).toHaveLength(0);
  });

  it('should handle lines with missing text field', () => {
    const input = `{"type":"user"}
{"type":"assistant","text":"Response"}`;

    const messages = parseJsonl(input);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
  });

  it('should extract timestamp when available', () => {
    const input = `{"type":"user","text":"Hello","timestamp":1234567890}`;

    const messages = parseJsonl(input);

    expect(messages[0].timestamp).toBe(1234567890);
  });

  it('should extract model when available', () => {
    const input = `{"type":"assistant","text":"Hello","model":"claude-opus-4-8"}`;

    const messages = parseJsonl(input);

    expect(messages[0].model).toBe('claude-opus-4-8');
  });
});
