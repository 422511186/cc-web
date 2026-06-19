import { describe, expect, it } from 'vitest';
import * as shared from './index.js';
import type { PendingPrompt, ServerEvent } from './events.js';
import type { ChangeModeRequest, ResolvePromptResponse } from './api.js';

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
      { type: 'user_message', text: '看看图片', imagePaths: ['C:/uploads/shot.png'] },
      { type: 'status', state: 'executing' },
      { type: 'run_info', model: 'claude-opus-4-8' },
      { type: 'closed', reason: 'detached' },
    ];

    expect(events[0]).toMatchObject({
      type: 'user_message',
      imagePaths: ['C:/uploads/shot.png'],
    });
    expect(events[1]).toMatchObject({ type: 'status', state: 'executing' });
    expect(events[2]).toMatchObject({ type: 'run_info', model: 'claude-opus-4-8' });
    expect(events[3]).toMatchObject({ type: 'closed', reason: 'detached' });
  });

  it('ServerEvent 覆盖发布订阅、队列、模式和撤销契约', () => {
    const events: ServerEvent[] = [
      { type: 'message_queued', operationId: 'op-1', queuePosition: 1 },
      { type: 'message_processing', operationId: 'op-1' },
      { type: 'message_completed', operationId: 'op-1' },
      { type: 'message_failed', operationId: 'op-2', message: 'model failed' },
      {
        type: 'prompt_resolved',
        promptId: 'perm-1',
        resolvedByDeviceName: 'Chrome on Android',
        decision: 'allow',
      },
      {
        type: 'mode_changed',
        mode: 'plan',
        changedByDeviceName: 'Edge on Windows',
        appliesTo: 'next_turn',
      },
      {
        type: 'device_revoked',
        message: '此设备授权已被 Host 撤销，请重新授权',
      },
    ];

    expect(events.map((event) => event.type)).toEqual([
      'message_queued',
      'message_processing',
      'message_completed',
      'message_failed',
      'prompt_resolved',
      'mode_changed',
      'device_revoked',
    ]);
  });

  it('API 契约支持模式切换和 prompt 竞争响应', () => {
    const change: ChangeModeRequest = {
      operationId: 'op-mode',
      mode: 'bypassPermissions',
      clientId: 'client-phone',
      deviceName: 'Chrome on Android',
    };
    const response: ResolvePromptResponse = {
      ok: false,
      reason: 'prompt_already_resolved',
      resolvedByDeviceName: 'Edge on Windows',
    };

    expect(change.mode).toBe('bypassPermissions');
    expect(response.reason).toBe('prompt_already_resolved');
  });

  it('运行时导出 Claude 会话模式列表，供前后端共享校验', () => {
    expect(shared.CLAUDE_SESSION_MODES).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'auto',
      'bypassPermissions',
    ]);
  });
});
