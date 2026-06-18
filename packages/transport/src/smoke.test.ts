import { describe, expect, it } from "vitest";
import { HttpTransport } from "./index.js";

describe("@coderelay/transport", () => {
  it("exposes HttpTransport", () => {
    expect(typeof HttpTransport).toBe("function");
  });
});
