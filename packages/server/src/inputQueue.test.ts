import { describe, it, expect } from "vitest";
import { InputQueue } from "./inputQueue.js";

describe("InputQueue", () => {
  it("yields pushed messages in order", async () => {
    const q = new InputQueue();
    q.push("hello");
    q.push("world");
    q.close();

    const got: string[] = [];
    for await (const msg of q) {
      // message.content 是字符串
      got.push(msg.message.content as string);
    }
    expect(got).toEqual(["hello", "world"]);
  });

  it("waits for a message pushed after iteration starts", async () => {
    const q = new InputQueue();
    const collected: string[] = [];

    const consumer = (async () => {
      for await (const msg of q) {
        collected.push(msg.message.content as string);
      }
    })();

    // 迭代已开始且在等待
    await new Promise((r) => setTimeout(r, 10));
    q.push("late");
    q.close();

    await consumer;
    expect(collected).toEqual(["late"]);
  });

  it("close ends iteration even with no messages", async () => {
    const q = new InputQueue();
    q.close();
    const got: string[] = [];
    for await (const msg of q) got.push(msg.message.content as string);
    expect(got).toEqual([]);
  });

  it("P2-B8: 并发调用 next() 时第二个调用应覆盖 waiting，第一个调用应被拒绝返回 done=true", async () => {
    const q = new InputQueue();
    const iter = q[Symbol.asyncIterator]();

    // 并发调用两次 next()，都在等待消息
    const promise1 = iter.next();
    const promise2 = iter.next();

    // 推送一条消息，应该只有最后一个 waiting（promise2）收到
    q.push("message");

    // promise2 应该解析为消息
    const result2 = await promise2;
    expect(result2.done).toBe(false);
    expect(result2.value.message.content).toBe("message");

    // promise1 应该被拒绝，返回 done=true（修复后行为）
    const result1 = await promise1;
    expect(result1.done).toBe(true);
  });
});
