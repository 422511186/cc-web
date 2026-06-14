import { describe, it, expect } from 'vitest';
import { extractTitle } from './title.js';
describe('extractTitle', () => {
    it('should extract title from first user message', () => {
        const messages = [
            { role: 'user', content: 'Hello, how are you?', timestamp: 123 },
            { role: 'assistant', content: 'I am fine', timestamp: 124 },
        ];
        const title = extractTitle(messages);
        expect(title).toBe('Hello, how are you?');
    });
    it('should truncate long titles to 50 characters', () => {
        const messages = [
            {
                role: 'user',
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
            { role: 'assistant', content: 'Hello', timestamp: 123 },
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
            { role: 'assistant', content: 'Welcome', timestamp: 122 },
            { role: 'system', content: 'System', timestamp: 123 },
            { role: 'user', content: 'My question', timestamp: 124 },
        ];
        const title = extractTitle(messages);
        expect(title).toBe('My question');
    });
    it('should handle messages with only whitespace', () => {
        const messages = [
            { role: 'user', content: '   \n\t  ', timestamp: 123 },
            { role: 'user', content: 'Real message', timestamp: 124 },
        ];
        const title = extractTitle(messages);
        expect(title).toBe('Real message');
    });
});
//# sourceMappingURL=title.test.js.map