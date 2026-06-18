import { describe, it, expect } from "vitest";
import { PendingRegistry } from "./pending.js";

describe("PendingRegistry", () => {
  it("register returns id + promise that resolves on settle", async () => {
    const reg = new PendingRegistry();
    const { id, promise } = reg.register<string>();
    expect(typeof id).toBe("string");

    const settled = reg.settle(id, "yes");
    expect(settled).toBe(true);
    await expect(promise).resolves.toBe("yes");
  });

  it("settle on unknown id returns false", () => {
    const reg = new PendingRegistry();
    expect(reg.settle("ghost", "x")).toBe(false);
  });

  it("settle twice on same id returns false the second time", async () => {
    const reg = new PendingRegistry();
    const { id, promise } = reg.register<number>();
    expect(reg.settle(id, 1)).toBe(true);
    expect(reg.settle(id, 2)).toBe(false);
    await expect(promise).resolves.toBe(1);
  });

  it("rejectAll rejects every outstanding promise", async () => {
    const reg = new PendingRegistry();
    const a = reg.register<string>();
    const b = reg.register<string>();
    reg.rejectAll(new Error("closed"));
    await expect(a.promise).rejects.toThrow("closed");
    await expect(b.promise).rejects.toThrow("closed");
    // 拒绝后登记表应清空,旧 id settle 失败
    expect(reg.settle(a.id, "x")).toBe(false);
  });

  it("has reflects outstanding state", () => {
    const reg = new PendingRegistry();
    const { id } = reg.register<string>();
    expect(reg.has(id)).toBe(true);
    reg.settle(id, "x");
    expect(reg.has(id)).toBe(false);
  });
});
