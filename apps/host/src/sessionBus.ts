import type { ServerEvent } from "@coderelay/shared";

export interface SessionBusOptions {
  readonly runId: string;
  readonly maxLogEvents?: number;
}

export type SessionSubscriber = (event: ServerEvent) => void;

export interface PromptResolutionResult {
  readonly ok: boolean;
  readonly reason?: "prompt_already_resolved" | "prompt_not_found";
  readonly resolvedByDeviceName?: string;
}

export class SessionBus {
  private readonly subscribers = new Map<string, SessionSubscriber>();
  private readonly log: ServerEvent[] = [];
  private readonly operations = new Map<string, unknown>();
  private readonly prompts = new Map<string, { resolvedByDeviceName?: string; decision?: string }>();
  private readonly maxLogEvents: number;

  constructor(private readonly options: SessionBusOptions) {
    this.maxLogEvents = options.maxLogEvents ?? 10_000;
  }

  subscribe(id: string, subscriber: SessionSubscriber): () => void {
    this.subscribers.set(id, subscriber);
    for (const event of this.log) {
      subscriber(event);
    }
    return () => {
      if (this.subscribers.get(id) === subscriber) {
        this.subscribers.delete(id);
      }
    };
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  eventCount(): number {
    return this.log.length;
  }

  publish(event: ServerEvent): void {
    this.log.push(event);
    if (this.log.length > this.maxLogEvents) {
      this.log.splice(0, this.log.length - this.maxLogEvents);
    }
    for (const subscriber of this.subscribers.values()) {
      subscriber(event);
    }
  }

  claimOperation<T>(operationId: string, result: T): { readonly first: boolean; readonly result: T } {
    if (this.operations.has(operationId)) {
      return { first: false, result: this.operations.get(operationId) as T };
    }
    this.operations.set(operationId, result);
    return { first: true, result };
  }

  trackPrompt(promptId: string): void {
    if (!this.prompts.has(promptId)) {
      this.prompts.set(promptId, {});
    }
  }

  resolvePrompt(promptId: string, deviceName: string, decision: string): PromptResolutionResult {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return { ok: false, reason: "prompt_not_found" };
    }
    if (prompt.resolvedByDeviceName) {
      return {
        ok: false,
        reason: "prompt_already_resolved",
        resolvedByDeviceName: prompt.resolvedByDeviceName,
      };
    }

    prompt.resolvedByDeviceName = deviceName;
    prompt.decision = decision;
    this.publish({
      type: "prompt_resolved",
      promptId,
      resolvedByDeviceName: deviceName,
      decision,
    });
    return { ok: true, resolvedByDeviceName: deviceName };
  }
}
