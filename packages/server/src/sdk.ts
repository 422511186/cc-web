import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKUserMessage,
  PermissionResult,
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
  permissionMode: string;
  cwd?: string;
  canUseTool: CanUseToolFn;
  abortController: AbortController;
}

/** 窄接口:会话状态机只依赖它 */
export interface SdkClient {
  /** 启动查询,返回 SDK 消息的异步迭代器 */
  start(params: StartQueryParams): AsyncIterable<SDKMessage>;
}

/** 生产用的真实适配器,直接转调 SDK 的 query() */
export const realSdkClient: SdkClient = {
  start(params) {
    return query({
      prompt: params.prompt,
      options: {
        resume: params.resume,
        permissionMode: params.permissionMode as never,
        cwd: params.cwd,
        canUseTool: (toolName, input, opts) =>
          params.canUseTool(toolName, input, {
            toolUseID: opts.toolUseID,
            title: opts.title,
          }),
        includePartialMessages: true,
        abortController: params.abortController,
      },
    });
  },
};
