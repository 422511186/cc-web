import { describe, expect, it } from 'vitest';
import * as shared from './index.js';
import type { PendingPrompt, ServerEvent } from './events.js';

describe('shared events contracts', () => {
  it('barrel export 暴露共享契约入口', () => {
    expect(shared).toBeDefined();
    expect(Object.prototype.toString.call(shared)).toBe('[object Module]');
  });

  it('PermissionPrompt 允许携带可选 diff 预览', () => {
    const prompt: PendingPrompt = {
      kind: 'permission',
      id: 'p1',
      toolName: 'Edit',
      title: 'Claude wants to edit a file',
      detail: '/project/src/app.ts',
      diff: '--- old\n+++ new\n@@\n-old\n+new',
    };

    expect(prompt.kind).toBe('permission');
    expect(prompt.diff).toContain('@@');
  });

  it('ServerEvent 覆盖运行时状态与关闭原因契约', () => {
    const events: ServerEvent[] = [
      { type: 'status', state: 'executing' },
      { type: 'run_info', model: 'claude-opus-4-8' },
      { type: 'closed', reason: 'detached' },
    ];

    expect(events[0]).toMatchObject({ type: 'status', state: 'executing' });
    expect(events[1]).toMatchObject({ type: 'run_info', model: 'claude-opus-4-8' });
    expect(events[2]).toMatchObject({ type: 'closed', reason: 'detached' });
  });
});
