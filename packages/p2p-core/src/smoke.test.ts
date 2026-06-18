import { describe, expect, it } from "vitest";
import { createP2pCoreScaffold } from "./index.js";

describe("@coderelay/p2p-core scaffold", () => {
  it("exposes the package name", () => {
    expect(createP2pCoreScaffold().packageName).toBe("@coderelay/p2p-core");
  });
});
