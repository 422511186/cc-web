const NOISE_TYPES = new Set([
    'system',
    'mode',
    'permission-mode',
    'file-history-snapshot',
    'last-prompt',
]);
export function parseJsonl(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const messages = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            // Skip noise types
            if (!parsed.type || NOISE_TYPES.has(parsed.type)) {
                continue;
            }
            // Only process user/assistant/text types with content
            if (!parsed.text) {
                continue;
            }
            let role;
            if (parsed.type === 'user') {
                role = 'user';
            }
            else if (parsed.type === 'assistant' || parsed.type === 'text') {
                role = 'assistant';
            }
            else {
                continue;
            }
            messages.push({
                role,
                content: parsed.text,
                timestamp: parsed.timestamp || Date.now(),
                model: parsed.model,
            });
        }
        catch {
            // Skip malformed lines
            continue;
        }
    }
    return messages;
}
//# sourceMappingURL=jsonl.js.map