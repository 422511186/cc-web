import type {
  ServerEvent,
  PromptAnswer,
  PendingPrompt,
  QuestionPrompt,
} from "@cc-web/shared";
import type {
  SDKMessage,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { SdkClient } from "./sdk.js";
import { InputQueue } from "./inputQueue.js";
import { PendingRegistry } from "./pending.js";

export interface SessionOptions {
  client: SdkClient;
  permissionMode: string;
  onEvent: (event: ServerEvent) => void;
  /** 续聊则传原 session id */
  resume?: string;
  cwd?: string;
}

/** canUseTool 的决策结果在内部用这个表示,再翻译成 SDK PermissionResult */
type Decision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * 单个活跃会话。持有输入队列、待答登记表、AbortController。
 * 消费 SDK 输出并翻译成 ServerEvent;canUseTool 把交互登记为待答并挂起。
 */
export class Session {
  private input = new InputQueue();
  private pending = new PendingRegistry();
  private abort = new AbortController();
  private opts: SessionOptions;
  private closed = false;

  constructor(opts: SessionOptions) {
    this.opts = opts;
  }

  /** 追加一条用户消息 */
  send(text: string): void {
    this.input.push(text);
  }

  /** 提交用户对某待答事项的回答;返回是否命中一个未决项 */
  answer(answer: PromptAnswer): boolean {
    return this.pending.settle(answer.id, answer);
  }

  /** 关闭会话:结束输入、abort SDK、拒绝未决项、发 closed 事件 */
  close(reason: "idle" | "aborted" | "exited"): void {
    if (this.closed) return;
    this.closed = true;
    this.input.close();
    this.abort.abort();
    this.pending.rejectAll(new Error("session closed"));
    this.emit({ type: "closed", reason });
  }

  private emit(event: ServerEvent): void {
    this.opts.onEvent(event);
  }

  /** 把工具调用映射为待答事项,登记并挂起,等用户回答后翻译成决策 */
  private async requestDecision(
    toolName: string,
    input: Record<string, unknown>,
    meta: { toolUseID: string; title?: string }
  ): Promise<Decision> {
    let prompt: PendingPrompt;
    const { id, promise } = this.pending.register<PromptAnswer>();

    if (toolName === "AskUserQuestion") {
      const questions = (input.questions ?? []) as QuestionPrompt["questions"];
      prompt = { kind: "question", id, questions };
    } else if (toolName === "ExitPlanMode") {
      prompt = { kind: "plan", id, plan: String(input.plan ?? "") };
    } else {
      prompt = {
        kind: "permission",
        id,
        toolName,
        title: meta.title ?? `Claude wants to use ${toolName}`,
        detail: summarizeInput(toolName, input),
      };
    }

    this.emit({ type: "prompt", prompt });

    const answer = await promise; // ← 挂起,直到 answer() 或 close()

    if (answer.kind === "permission") {
      return answer.decision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "User denied" };
    }
    if (answer.kind === "plan") {
      return answer.decision === "approve"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "User rejected the plan" };
    }
    // question:把答案塞回工具入参
    return {
      behavior: "allow",
      updatedInput: { ...input, _answers: answer.answers },
    };
  }

  /** 启动 SDK 查询并消费输出,直到一轮/多轮结束或被关闭 */
  async runToCompletion(): Promise<void> {
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      meta: { toolUseID: string; title?: string }
    ): Promise<PermissionResult> => {
      try {
        const decision = await this.requestDecision(toolName, input, meta);
        if (decision.behavior === "allow") {
          return {
            behavior: "allow",
            updatedInput: decision.updatedInput ?? input,
          };
        }
        return { behavior: "deny", message: decision.message };
      } catch {
        // 会话关闭导致 reject
        return { behavior: "deny", message: "session closed" };
      }
    };

    try {
      const stream = this.opts.client.start({
        prompt: this.input,
        resume: this.opts.resume,
        permissionMode: this.opts.permissionMode,
        cwd: this.opts.cwd,
        canUseTool,
        abortController: this.abort,
      });

      for await (const msg of stream) {
        if (this.closed) break;
        this.handleSdkMessage(msg);
      }
    } catch (err) {
      if (!this.closed) {
        this.emit({ type: "error", message: (err as Error).message });
      }
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case "stream_event": {
        const ev = (
          msg as {
            event?: {
              type?: string;
              delta?: { type?: string; text?: string };
            };
          }
        ).event;
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          ev.delta.text
        ) {
          this.emit({ type: "delta", text: ev.delta.text });
        }
        break;
      }
      case "assistant": {
        const content =
          (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const block of content as {
          type: string;
          text?: string;
          thinking?: string;
          name?: string;
          input?: unknown;
          id?: string;
        }[]) {
          if (block.type === "text") {
            this.emit({
              type: "block",
              block: { kind: "text", text: block.text ?? "" },
            });
          } else if (block.type === "thinking") {
            this.emit({
              type: "block",
              block: { kind: "thinking", text: block.thinking ?? "" },
            });
          } else if (block.type === "tool_use") {
            this.emit({
              type: "block",
              block: {
                kind: "tool_use",
                name: block.name ?? "",
                input: block.input,
                toolUseId: block.id ?? "",
              },
            });
          }
        }
        break;
      }
      case "result": {
        const isError = (msg as { is_error?: boolean }).is_error ?? false;
        this.emit({ type: "turn_end", isError });
        break;
      }
      default:
        // 其余 SDK 消息类型本计划忽略
        break;
    }
  }
}

/** 把工具入参压成一行可读摘要,给权限卡片显示 */
function summarizeInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  try {
    return JSON.stringify(input).slice(0, 200);
  } catch {
    return toolName;
  }
}
