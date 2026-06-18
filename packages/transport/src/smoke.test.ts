import { describe, expect, it } from "vitest";
import { createTransportScaffold } from "./index.js";

describe("@coderelay/transport scaffold", () => {
  it("exposes the package name", () => {
    expect(createTransportScaffold().packageName).toBe("@coderelay/transport");
  });
});
