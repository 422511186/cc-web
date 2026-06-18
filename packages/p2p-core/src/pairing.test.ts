import { describe, expect, it } from "vitest";
import * as core from "./index.js";

const api = core as Record<string, unknown>;

function expectApiFunction<T extends (...args: any[]) => any>(name: string): T {
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("pairing protocol", () => {
  it("creates a QR payload with host public material and no private key material", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createPairingOffer = expectApiFunction("createPairingOffer");
    const host = await createDeviceIdentity({ deviceId: "host-1" });

    const offer = createPairingOffer({
      webUrl: "https://coderelay.example.app",
      signalUrl: "wss://signal.example.app",
      host,
      pairingId: "pair-1",
      pairingSecret: "secret-1",
      now: Date.parse("2026-06-18T10:00:00.000Z"),
      ttlMs: 120_000,
    });

    expect(offer).toEqual({
      protocol: "coderelay-pairing-v1",
      webUrl: "https://coderelay.example.app",
      signalUrl: "wss://signal.example.app",
      hostId: "host-1",
      hostPublicKeyJwk: host.publicKeyJwk,
      hostPublicKeyFingerprint: host.publicKeyFingerprint,
      pairingId: "pair-1",
      pairingSecret: "secret-1",
      expiresAt: "2026-06-18T10:02:00.000Z",
    });
    expect(JSON.stringify(offer)).not.toContain(host.privateKeyJwk.d);
  });

  it("rejects a pairing offer after expiration", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createPairingOffer = expectApiFunction("createPairingOffer");
    const verifyPairingOffer = expectApiFunction("verifyPairingOffer");
    const host = await createDeviceIdentity({ deviceId: "host-1" });
    const offer = createPairingOffer({
      webUrl: "https://coderelay.example.app",
      signalUrl: "wss://signal.example.app",
      host,
      pairingId: "pair-1",
      pairingSecret: "secret-1",
      now: Date.parse("2026-06-18T10:00:00.000Z"),
      ttlMs: 120_000,
    });

    expect(verifyPairingOffer(offer, { now: Date.parse("2026-06-18T10:01:59.999Z") })).toEqual({ ok: true });
    expect(verifyPairingOffer(offer, { now: Date.parse("2026-06-18T10:02:00.001Z") })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects an expired pairing proof before trusting the client", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createPairingOffer = expectApiFunction("createPairingOffer");
    const createPairingProof = expectApiFunction("createPairingProof");
    const acceptPairingProof = expectApiFunction("acceptPairingProof");
    const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
    const host = await createDeviceIdentity({ deviceId: "host-1" });
    const client = await createDeviceIdentity({ deviceId: "phone-1" });
    const offer = createPairingOffer({
      webUrl: "https://coderelay.example.app",
      signalUrl: "wss://signal.example.app",
      host,
      pairingId: "pair-1",
      pairingSecret: "secret-1",
      now: Date.parse("2026-06-18T10:00:00.000Z"),
      ttlMs: 120_000,
    });
    const proof = await createPairingProof(offer, client);

    await expect(
      acceptPairingProof(createTrustedDeviceStore(), offer, proof, {
        now: Date.parse("2026-06-18T10:03:00.000Z"),
        displayName: "Phone",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "expired",
      store: createTrustedDeviceStore(),
    });
  });

  it("rejects challenge authorization when signature payload or signer is wrong", async () => {
    const createDeviceIdentity = expectApiFunction("createDeviceIdentity");
    const createTrustedDeviceStore = expectApiFunction("createTrustedDeviceStore");
    const trustClient = expectApiFunction("trustClient");
    const createChallenge = expectApiFunction("createChallenge");
    const signChallenge = expectApiFunction("signChallenge");
    const authorizeClientChallenge = expectApiFunction("authorizeClientChallenge");
    const client = await createDeviceIdentity({ deviceId: "phone-1" });
    const intruder = await createDeviceIdentity({ deviceId: "phone-x" });
    const trusted = trustClient(createTrustedDeviceStore(), {
      clientId: client.deviceId,
      clientPublicKeyJwk: client.publicKeyJwk,
      displayName: "Phone",
      addedAt: "2026-06-18T10:00:00.000Z",
    });
    const challenge = createChallenge({
      challengeId: "challenge-1",
      nonce: "nonce-1",
      issuedAt: "2026-06-18T10:00:00.000Z",
    });
    const proof = await signChallenge(client, challenge);
    const intruderProof = await signChallenge(intruder, challenge);

    await expect(
      authorizeClientChallenge(trusted, {
        clientId: client.deviceId,
        clientPublicKeyJwk: client.publicKeyJwk,
        challenge,
        signature: proof.signature,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      authorizeClientChallenge(trusted, {
        clientId: client.deviceId,
        clientPublicKeyJwk: client.publicKeyJwk,
        challenge: { ...challenge, nonce: "tampered" },
        signature: proof.signature,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
    await expect(
      authorizeClientChallenge(trusted, {
        clientId: intruder.deviceId,
        clientPublicKeyJwk: intruder.publicKeyJwk,
        challenge,
        signature: intruderProof.signature,
      }),
    ).resolves.toEqual({ ok: false, reason: "untrusted_client" });
    await expect(
      authorizeClientChallenge(trusted, {
        clientId: client.deviceId,
        clientPublicKeyJwk: client.publicKeyJwk,
        challenge,
        signature: intruderProof.signature,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
  });
});
