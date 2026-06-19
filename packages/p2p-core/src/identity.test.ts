import { describe, expect, it } from "vitest";
import * as core from "./index.js";

const api = core as Record<string, unknown>;

function expectApiFunction<T extends (...args: any[]) => any>(name: string): T {
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("device identity", () => {
  it("creates identities and verifies signatures when WebCrypto subtle is unavailable", async () => {
    const originalSubtle = crypto.subtle;
    Object.defineProperty(crypto, "subtle", {
      configurable: true,
      value: undefined,
    });

    try {
      const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
      const createPairingOffer = expectApiFunction("createPairingOffer");
      const createPairingProof = expectApiFunction("createPairingProof");
      const acceptPairingProof = expectApiFunction("acceptPairingProof");
      const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
      const host = await createDeviceIdentity({ deviceId: "host-http" });
      const phone = await createDeviceIdentity({ deviceId: "phone-http" });
      const offer = createPairingOffer({
        webUrl: "http://172.30.1.102:3100",
        signalUrl: "ws://172.30.1.102:8787/",
        host,
        pairingId: "pair-http",
        pairingSecret: "secret-http",
        now: Date.parse("2026-06-19T10:00:00.000Z"),
      });
      const proof = await createPairingProof(offer, phone);

      await expect(
        acceptPairingProof(createTrustedDeviceStore(), offer, proof, {
          now: Date.parse("2026-06-19T10:00:01.000Z"),
        }),
      ).resolves.toEqual({
        ok: true,
        store: expect.objectContaining({
          trustedClients: [
            expect.objectContaining({
              clientId: "phone-http",
              clientPublicKeyJwk: phone.publicKeyJwk,
            }),
          ],
        }),
      });
    } finally {
      Object.defineProperty(crypto, "subtle", {
        configurable: true,
        value: originalSubtle,
      });
    }
  });

  it("creates a long-lived identity and can expose it without private key material", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const toPublicDeviceDescriptor = expectApiFunction("toPublicDeviceDescriptor");

    const identity = await createDeviceIdentity({
      deviceId: "host-1",
      createdAt: "2026-06-18T10:00:00.000Z",
    });
    const publicDescriptor = toPublicDeviceDescriptor(identity);

    expect(identity).toMatchObject({
      deviceId: "host-1",
      publicKeyFingerprint: expect.any(String),
      createdAt: "2026-06-18T10:00:00.000Z",
    });
    expect(identity.publicKeyJwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(identity.privateKeyJwk).toMatchObject({ kty: "EC", crv: "P-256", d: expect.any(String) });
    expect(publicDescriptor).toEqual({
      deviceId: "host-1",
      publicKeyJwk: identity.publicKeyJwk,
      publicKeyFingerprint: identity.publicKeyFingerprint,
    });
    expect(JSON.stringify(publicDescriptor)).not.toContain(identity.privateKeyJwk.d);
  });

  it("does not authorize an unknown client", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
    const isTrustedClient = expectApiFunction("isTrustedClient");
    const client = await createDeviceIdentity({ deviceId: "phone-unknown" });

    expect(isTrustedClient(createTrustedDeviceStore(), client.deviceId, client.publicKeyJwk)).toBe(false);
  });

  it("stores multiple trusted clients and revokes only the selected device", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
    const trustClient = expectApiFunction("trustClient");
    const revokeClient = expectApiFunction("revokeClient");
    const isTrustedClient = expectApiFunction("isTrustedClient");
    const phoneA = await createDeviceIdentity({ deviceId: "phone-a" });
    const phoneB = await createDeviceIdentity({ deviceId: "phone-b" });

    const trusted = trustClient(
      trustClient(createTrustedDeviceStore(), {
        clientId: phoneA.deviceId,
        clientPublicKeyJwk: phoneA.publicKeyJwk,
        displayName: "iPhone",
        addedAt: "2026-06-18T10:00:00.000Z",
      }),
      {
        clientId: phoneB.deviceId,
        clientPublicKeyJwk: phoneB.publicKeyJwk,
        displayName: "Android",
        addedAt: "2026-06-18T10:01:00.000Z",
      },
    );

    expect(isTrustedClient(trusted, phoneA.deviceId, phoneA.publicKeyJwk)).toBe(true);
    expect(isTrustedClient(trusted, phoneB.deviceId, phoneB.publicKeyJwk)).toBe(true);

    const revoked = revokeClient(trusted, phoneA.deviceId, {
      revokedAt: "2026-06-18T10:02:00.000Z",
    });

    expect(isTrustedClient(revoked, phoneA.deviceId, phoneA.publicKeyJwk)).toBe(false);
    expect(isTrustedClient(revoked, phoneB.deviceId, phoneB.publicKeyJwk)).toBe(true);
    expect(revoked.trustedClients).toEqual([
      expect.objectContaining({
        clientId: "phone-a",
        revokedAt: "2026-06-18T10:02:00.000Z",
      }),
      expect.objectContaining({
        clientId: "phone-b",
        revokedAt: undefined,
      }),
    ]);
  });

  it("stores a trusted host on the client side without private key material", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
    const trustHost = expectApiFunction("trustHost");
    const isTrustedHost = expectApiFunction("isTrustedHost");
    const host = await createDeviceIdentity({ deviceId: "host-1" });

    const trusted = trustHost(createTrustedDeviceStore(), {
      hostId: host.deviceId,
      hostPublicKeyJwk: host.publicKeyJwk,
      displayName: "My PC",
      addedAt: "2026-06-18T10:00:00.000Z",
    });

    expect(isTrustedHost(trusted, host.deviceId, host.publicKeyJwk)).toBe(true);
    expect(JSON.stringify(trusted.trustedHosts)).not.toContain(host.privateKeyJwk.d);
  });
});
