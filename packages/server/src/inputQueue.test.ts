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
});
