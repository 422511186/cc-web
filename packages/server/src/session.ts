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
import { buildDiff } from "./diffBuilder.js";

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
  private detached = false;
  private abortingCurrentTurn = false;
  private resumeId: string | undefined;
  /** 当前是否有一轮在执行(已 send、未到 turn_end) */
  private executing = false;
  /** 已 emit 过 run_info 的模型,避免每条 assistant 消息重复广播 */
  private reportedModel: string | null = null;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.resumeId = opts.resume;
  }

  /** 追加一条用户消息 */
  send(text: string): void {
    this.executing = true;
    // 每次 send 重置 reportedModel,让续聊第二轮能重新上报新模型
    this.reportedModel = null;
    // 回显进事件流:重连整段重放时仍能看到用户自己的提问
    this.emit({ type: "user_message", text });
    // 状态转移:开始执行
    this.emit({ type: "status", state: "executing" });
    this.input.push(text);
  }

  /**
   * 会话是否「忙」:一轮执行中(已 send、未到 turn_end),或有待答项等用户回答。
   * 切走时据此决定保活(忙)还是立即回收(空闲)。
   */
  isBusy(): boolean {
    return this.executing || this.pending.hasAny();
  }

  /** 提交用户对某待答事项的回答;返回是否命中一个未决项 */
  answer(answer: PromptAnswer): boolean {
    return this.pending.settle(answer.id, answer);
  }

  /** 停止当前轮次:中止 SDK 当前执行,但保留会话与 SSE 连接,允许后续继续输入。 */
  abortCurrentTurn(): void {
    if (this.closed || this.detached) return;
    const wasBusy = this.executing || this.pending.hasAny();
    this.abortingCurrentTurn = true;
    this.executing = false;
    this.pending.rejectAll(new Error("turn aborted"));
    this.abort.abort();
    this.abort = new AbortController();
    if (wasBusy) {
      this.emit({ type: "turn_end", isError: true });
    }
    this.emit({ type: "status", state: "idle" });
  }

  /** 关闭会话:结束输入、abort SDK、拒绝未决项、发 closed 事件 */
  close(reason: "idle" | "aborted" | "exited"): void {
    if (this.closed) return;
    // 已优雅分离:任务自然结束后的兜底 close 应为 no-op(不再 abort/重复 emit)
    if (this.detached) {
      this.closed = true;
      return;
    }
    this.closed = true;
    this.input.close();
    this.abort.abort();
    this.pending.rejectAll(new Error("session closed"));
    this.emit({ type: "closed", reason });
  }

  /**
   * 优雅分离:前端断开/切换/关页面时调用。
   * 停止接收新输入、拒绝无人应答的待答项,但**不 abort** —— 正在执行的轮次会跑完,
   * SDK 回头读下一条输入时拿到 done 自然结束。结束后由 runToCompletion 触发回收。
   */
  detach(): void {
    if (this.closed || this.detached) return;
    this.detached = true;
    this.input.close();
    // 无人应答的待答项要拒绝,否则当前轮次会永远挂起、无法自然结束
    this.pending.rejectAll(new Error("session detached"));
    this.emit({ type: "closed", reason: "detached" });
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
      // 权限类工具:尝试生成 diff 预览
      const diff = buildDiff(toolName, input);
      prompt = {
        kind: "permission",
        id,
        toolName,
        title: meta.title ?? `Claude wants to use ${toolName}`,
        detail: summarizeInput(toolName, input),
        diff: diff ?? undefined, // 有 diff 则附加,否则省略
      };
    }

    this.emit({ type: "prompt", prompt });
    // 状态转移:出现待答项,等用户回答
    this.emit({ type: "status", state: "waiting" });

    const answer = await promise; // ← 挂起,直到 answer() 或 close()

    // 用户已回答,回到执行中(继续跑该轮)
    this.emit({ type: "status", state: "executing" });

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
    while (!this.closed && !this.detached) {
      const abortController = this.abort;
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
          // 会话关闭/当前轮次停止导致 reject
          return { behavior: "deny", message: "session closed" };
        }
      };

      try {
        const stream = this.opts.client.start({
          prompt: this.input,
          resume: this.resumeId,
          permissionMode: this.opts.permissionMode,
          cwd: this.opts.cwd,
          canUseTool,
          abortController,
        });

        for await (const msg of stream) {
          if (this.closed || this.detached) break;
          this.handleSdkMessage(msg);
        }
      } catch (err) {
        const isTurnAbort =
          this.abortingCurrentTurn || abortController.signal.aborted;
        if (!this.closed && !this.detached && !isTurnAbort) {
          this.emit({ type: "error", message: (err as Error).message });
        }
      }

      if (this.closed || this.detached) break;
      if (this.abortingCurrentTurn || abortController.signal.aborted) {
        this.abortingCurrentTurn = false;
        continue;
      }
      break;
    }
  }

  private handleSdkMessage(msg: SDKMessage): void {
    const sessionId = (msg as { session_id?: string }).session_id;
    if (sessionId) {
      this.resumeId = sessionId;
    }
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
        // 提取当前活跃 run 的模型(首次见到即广播一次)。
        // 注意:SDK assistant 消息不携带 effort/推理强度,故只报 model。
        const model = (msg as { message?: { model?: string } }).message?.model;
        if (model && model !== this.reportedModel) {
          this.reportedModel = model;
          this.emit({ type: "run_info", model });
        }
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
        this.executing = false;
        this.emit({ type: "turn_end", isError });
        // 状态转移:一轮结束,回到空闲可发下一条
        this.emit({ type: "status", state: "idle" });
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
