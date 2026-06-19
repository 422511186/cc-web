import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createDeviceIdentity, trustClient } from "@coderelay/p2p-core";

async function loadApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./p2pStateStore.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function expectApiFunction<T extends (...args: any[]) => any>(name: string): Promise<T> {
  const api = await loadApi();
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("Host P2P state store", () => {
  it("creates a persistent host identity and reloads trusted clients across restarts", async () => {
    const loadOrCreateHostP2PState = await expectApiFunction("loadOrCreateHostP2PState");
    const dir = mkdtempSync(join(tmpdir(), "coderelay-p2p-state-"));
    const stateFile = join(dir, "state.json");

    try {
      const first = await loadOrCreateHostP2PState(stateFile, "host-test");
      expect(first.identity.deviceId).toBe("host-test");
      expect(first.identity.privateKeyJwk).toMatchObject({ d: expect.any(String) });
      expect(first.trustedDeviceStore).toEqual({
        trustedClients: [],
        trustedHosts: [],
      });

      const phoneA = await createDeviceIdentity({ deviceId: "phone-a" });
      const phoneB = await createDeviceIdentity({ deviceId: "phone-b" });
      await first.saveTrustedDeviceStore(
        trustClient(
          trustClient(first.trustedDeviceStore, {
            clientId: phoneA.deviceId,
            clientPublicKeyJwk: phoneA.publicKeyJwk,
            addedAt: "2026-06-19T00:00:00.000Z",
          }),
          {
            clientId: phoneB.deviceId,
            clientPublicKeyJwk: phoneB.publicKeyJwk,
            addedAt: "2026-06-19T00:01:00.000Z",
          },
        ),
      );

      const second = await loadOrCreateHostP2PState(stateFile, "host-test");

      expect(second.identity).toEqual(first.identity);
      expect(second.trustedDeviceStore.trustedClients.map((client: { clientId: string }) => client.clientId)).toEqual([
        "phone-a",
        "phone-b",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recreates identity and trusted clients when stored hostId differs from current config", async () => {
    const loadOrCreateHostP2PState = await expectApiFunction("loadOrCreateHostP2PState");
    const dir = mkdtempSync(join(tmpdir(), "coderelay-p2p-state-"));
    const stateFile = join(dir, "state.json");

    try {
      const staleIdentity = await createDeviceIdentity({ deviceId: "coderelay-e2e-host" });
      const stalePhone = await createDeviceIdentity({ deviceId: "phone-old" });
      writeFileSync(
        stateFile,
        `${JSON.stringify(
          {
            identity: staleIdentity,
            trustedDeviceStore: trustClient(
              { trustedClients: [], trustedHosts: [] },
              {
                clientId: stalePhone.deviceId,
                clientPublicKeyJwk: stalePhone.publicKeyJwk,
                addedAt: "2026-06-19T00:00:00.000Z",
              },
            ),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const state = await loadOrCreateHostP2PState(stateFile, "coderelay-local-host");

      expect(state.identity.deviceId).toBe("coderelay-local-host");
      expect(state.identity.publicKeyFingerprint).not.toBe(staleIdentity.publicKeyFingerprint);
      expect(state.trustedDeviceStore).toEqual({
        trustedClients: [],
        trustedHosts: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
