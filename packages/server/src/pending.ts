import { randomUUID } from "node:crypto";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

/**
 * 待答事项登记表。register() 登记一个挂起 Promise 并返回 id;
 * settle(id, value) 解决它;rejectAll() 在会话关闭时拒绝所有未决项。
 */
export class PendingRegistry {
  private entries = new Map<string, Deferred<unknown>>();

  register<T>(): { id: string; promise: Promise<T> } {
    const id = randomUUID();
    let resolve!: (value: T) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.entries.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    return { id, promise };
  }

  settle(id: string, value: unknown): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    entry.resolve(value);
    return true;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  rejectAll(err: Error): void {
    for (const entry of this.entries.values()) {
      entry.reject(err);
    }
    this.entries.clear();
  }
}
