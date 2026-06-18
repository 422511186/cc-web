import { describe, expect, it } from "vitest";
import { createPairingOffer, createTrustedDeviceStore } from "./index.js";

describe("@coderelay/p2p-core", () => {
  it("exports device trust and pairing protocol helpers", () => {
    expect(createTrustedDeviceStore()).toEqual({ trustedClients: [], trustedHosts: [] });
    expect(typeof createPairingOffer).toBe("function");
  });
});
