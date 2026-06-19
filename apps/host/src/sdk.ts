import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKUserMessage,
  PermissionResult,
  PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";

/** canUseTool 回调的形态(只取我们用到的字段) */
export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  meta: { toolUseID: string; title?: string }
) => Promise<PermissionResult>;

/** 启动一次 SDK 查询所需的参数 */
export interface StartQueryParams {
  /** 异步可迭代的用户消息流(我们用输入队列驱动) */
  prompt: AsyncIterable<SDKUserMessage>;
  /** 续聊则传 session id;新建不传 */
  resume?: string;
  permissionMode: PermissionMode;
  cwd?: string;
  canUseTool: CanUseToolFn;
  abortController: AbortController;
}

export interface SdkQuery extends AsyncIterable<SDKMessage> {
  setPermissionMode?: (mode: PermissionMode) => Promise<void>;
}

/** 窄接口:会话状态机只依赖它 */
export interface SdkClient {
  /** 启动查询,返回 SDK 消息的异步迭代器 */
  start(params: StartQueryParams): SdkQuery;
}

/** 生产用的真实适配器,直接转调 SDK 的 query() */
export const realSdkClient: SdkClient = {
  start(params) {
    return query({
      prompt: params.prompt,
      options: {
        resume: params.resume,
        // 续写原会话,不 fork 出新 session(避免历史记录里堆积大量分叉)
        ...(params.resume ? { forkSession: false } : {}),
        permissionMode: params.permissionMode,
        // SDK 运行中切到 bypassPermissions 要求进程启动时已经带此能力位；
        // 实际权限行为仍由 permissionMode / setPermissionMode 决定。
        allowDangerouslySkipPermissions: true,
        cwd: params.cwd,
        canUseTool: async (toolName, input, opts) => {
          try {
            return await params.canUseTool(toolName, input, {
              toolUseID: opts.toolUseID,
              title: opts.title,
            });
          } catch {
            return {
              behavior: "deny",
              message: "tool permission callback failed",
            } satisfies PermissionResult;
          }
        },
        includePartialMessages: true,
        abortController: params.abortController,
      },
    });
  },
};
