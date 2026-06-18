import { describe, expect, it } from "vitest";
import { signalServiceName } from "./index.js";

describe("CodeRelay Signal scaffold", () => {
  it("exposes the service name", () => {
    expect(signalServiceName()).toBe("CodeRelay Signal");
  });
});
