import { describe, expect, it } from "vitest";
import { createTestUtilsScaffold } from "./index.js";

describe("@coderelay/test-utils scaffold", () => {
  it("exposes the package name", () => {
    expect(createTestUtilsScaffold().packageName).toBe("@coderelay/test-utils");
  });
});
