import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * 一个异步队列,实现 AsyncIterable<SDKUserMessage>。
 * push() 追加一条用户消息;close() 结束迭代。
 * 消费端(SDK)在队列空时挂起,直到有新消息或被关闭。
 */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(text: string, attachments: string[] = []): void {
    if (this.closed) return;
    const content = formatMessageContent(text, attachments);
    const msg = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: msg, done: false });
    } else {
      this.buffer.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        // 修复 P2-B8: 拒绝被覆盖的 waiting promise，只保留最新的
        if (this.waiting) {
          const oldWaiting = this.waiting;
          // 立即拒绝旧的 waiting，防止它永久挂起
          Promise.resolve().then(() => {
            oldWaiting({ value: undefined as never, done: true });
          });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

function formatMessageContent(text: string, attachments: string[]): string {
  if (attachments.length === 0) return text;
  return [
    text,
    "",
    "Attached files:",
    ...attachments.map((filePath) => `- ${filePath}`),
  ].join("\n");
}
