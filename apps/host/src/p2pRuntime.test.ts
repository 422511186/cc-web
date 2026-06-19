import { describe, expect, it, vi } from "vitest";
import type { P2PMessagePort, P2PBridgeHandlers, P2PBridge } from "@coderelay/transport";
import { createDeviceIdentity, createPairingProof, createTrustedDeviceStore, signChallenge, trustClient } from "@coderelay/p2p-core";
import { HostP2PRuntime } from "./p2pRuntime.js";

describe("HostP2PRuntime", () => {
  it("connects to Signal, opens a pairing offer, and publishes a scannable pairing URL", async () => {
    const signal = new FakeSignalSocket();
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    const pairing = runtime.openPairing({});

    expect(signal.sent).toContainEqual({ type: "host.online", hostId: "host-test" });
    expect(signal.sent).toContainEqual({
      type: "pairing.open",
      hostId: "host-test",
      pairingId: "pair-test",
      expiresAt: "2026-06-19T00:02:00.000Z",
    });
    expect(pairing.offer).toEqual(
      expect.objectContaining({
        protocol: "coderelay-pairing-v1",
        webUrl: "http://web.test/",
        signalUrl: "ws://signal.test/",
        hostId: "host-test",
        hostPublicKeyFingerprint: expect.any(String),
        pairingId: "pair-test",
        pairingSecret: "secret-test",
        expiresAt: "2026-06-19T00:02:00.000Z",
      })
    );
    expect(pairing.pairingUrl).toMatch(/^http:\/\/web\.test\/\?p2p=/);

    const encoded = new URL(pairing.pairingUrl).searchParams.get("p2p");
    expect(encoded).toBeTruthy();
    expect(JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"))).toEqual(pairing.offer);
  });

  it("does not expose an expired pairing offer in status", async () => {
    const signal = new FakeSignalSocket();
    let now = Date.parse("2026-06-19T00:00:00.000Z");
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      now: () => now,
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    runtime.openPairing({});
    now = Date.parse("2026-06-19T00:02:01.000Z");

    expect(runtime.getStatus().activePairing).toBeUndefined();
  });

  it("accepts a client during an active pairing and bridges the incoming DataChannel", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const peer = new FakePeerConnection();
    const createBridge = vi.fn((_port: P2PMessagePort, _handlers: P2PBridgeHandlers): P2PBridge => ({
      close: vi.fn(),
    }));
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
        clientId: clientIdentity.deviceId,
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        addedAt: "2026-06-19T00:00:00.000Z",
      }),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => peer,
      createBridge,
    });

    await runtime.start();
    runtime.openPairing({});

    signal.emitMessage({
      type: "client.connect",
      requestId: "req-client",
      hostId: "host-test",
      clientId: clientIdentity.deviceId,
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    });

    expect(signal.sent).not.toContainEqual(
      expect.objectContaining({
        type: "connection.accept",
        requestId: "req-client",
      }),
    );
    await answerConnectionChallenge(signal, "req-client", clientIdentity);

    expect(signal.sent).toContainEqual({
      type: "connection.accept",
      requestId: "req-client",
      connectionId: "conn-test",
      clientId: "client-phone",
    });

    signal.emitMessage({
      type: "webrtc.offer",
      connectionId: "conn-test",
      sdp: "offer-sdp",
    });
    await flushAsync();

    expect(peer.remoteDescriptions).toEqual([{ type: "offer", sdp: "offer-sdp" }]);
    expect(peer.localDescriptions).toEqual([{ type: "answer", sdp: "answer-sdp" }]);
    expect(signal.sent).toContainEqual({
      type: "webrtc.answer",
      connectionId: "conn-test",
      sdp: "answer-sdp",
    });

    const channel = new FakeDataChannel();
    peer.emitDataChannel(channel);
    await flushAsync();

    expect(createBridge).toHaveBeenCalledTimes(1);
    const [port] = createBridge.mock.calls[0];
    const received: string[] = [];
    port.addMessageListener((message) => received.push(message));

    channel.emitMessage("hello from browser");
    expect(received).toEqual(["hello from browser"]);

    port.send("hello from host");
    expect(channel.sent).toEqual(["hello from host"]);
    expect(runtime.getStatus()).toEqual(
      expect.objectContaining({
        enabled: true,
        signalStatus: "connected",
        peerStatus: "connected",
        hostId: "host-test",
      })
    );
  });

  it("trusts a client only after a valid pairing proof, then allows that trusted client to connect", async () => {
    const hostIdentity = await createDeviceIdentity({
      deviceId: "host-test",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const persistedStores: unknown[] = [];
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      hostIdentity,
      trustedDeviceStore: createTrustedDeviceStore(),
      onTrustedDeviceStoreChanged: (store: unknown) => persistedStores.push(store),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    const pairing = runtime.openPairing({});
    const proof = await createPairingProof(pairing.offer, clientIdentity);

    signal.emitMessage({
      type: "client.connect",
      requestId: "req-before-pairing",
      hostId: "host-test",
      clientId: "client-phone",
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    });

    expect(signal.sent).not.toContainEqual(
      expect.objectContaining({
        type: "connection.accept",
        requestId: "req-before-pairing",
      }),
    );

    signal.emitMessage({
      type: "pairing.request",
      requestId: "pair-req",
      hostId: "host-test",
      pairingId: "pair-test",
      clientId: "client-phone",
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
      proof,
    });
    await waitFor(() =>
      signal.sent.some((message) => message.type === "pairing.accept" && message.requestId === "pair-req")
    );

    expect(signal.sent).toContainEqual({
      type: "pairing.accept",
      requestId: "pair-req",
      hostId: "host-test",
      clientId: "client-phone",
    });
    expect(persistedStores.at(-1)).toEqual(
      expect.objectContaining({
        trustedClients: [
          expect.objectContaining({
            clientId: "client-phone",
            clientPublicKeyJwk: clientIdentity.publicKeyJwk,
          }),
        ],
      }),
    );

    signal.emitMessage({
      type: "client.connect",
      requestId: "req-after-pairing",
      hostId: "host-test",
      clientId: "client-phone",
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-after-pairing", clientIdentity);

    expect(signal.sent).toContainEqual({
      type: "connection.accept",
      requestId: "req-after-pairing",
      connectionId: "conn-test",
      clientId: "client-phone",
    });
  });

  it("requires a trusted client to prove private-key possession before accepting a connection", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
        clientId: clientIdentity.deviceId,
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        addedAt: "2026-06-19T00:00:00.000Z",
      }),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    signal.emitMessage({
      type: "client.connect",
      requestId: "req-client",
      hostId: "host-test",
      clientId: clientIdentity.deviceId,
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    });

    const challengeMessage = signal.sent.find((message) => message.type === "connection.challenge");
    expect(challengeMessage).toEqual(
      expect.objectContaining({
        type: "connection.challenge",
        requestId: "req-client",
        hostId: "host-test",
        clientId: "client-phone",
        challenge: expect.objectContaining({ protocol: "coderelay-challenge-v1" }),
      }),
    );
    expect(signal.sent).not.toContainEqual(expect.objectContaining({ type: "connection.accept" }));

    await answerConnectionChallenge(signal, "req-client", clientIdentity);

    expect(signal.sent).toContainEqual({
      type: "connection.accept",
      requestId: "req-client",
      connectionId: "conn-test",
      clientId: "client-phone",
    });
  });

  it("does not let a slow old peer close clear a newer accepted peer", async () => {
    const oldClient = await createDeviceIdentity({
      deviceId: "client-phone-old",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const newClient = await createDeviceIdentity({
      deviceId: "client-phone-new",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const slowClose = createDeferred<void>();
    const oldPeer = new FakePeerConnection(slowClose.promise);
    const newPeer = new FakePeerConnection();
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      trustedDeviceStore: trustClient(
        trustClient(createTrustedDeviceStore(), {
          clientId: oldClient.deviceId,
          clientPublicKeyJwk: oldClient.publicKeyJwk,
          addedAt: "2026-06-19T00:00:00.000Z",
        }),
        {
          clientId: newClient.deviceId,
          clientPublicKeyJwk: newClient.publicKeyJwk,
          addedAt: "2026-06-19T00:00:00.000Z",
        },
      ),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createConnectionId: vi.fn()
        .mockReturnValueOnce("conn-old")
        .mockReturnValueOnce("conn-new"),
      createSignalSocket: () => signal,
      createPeerConnection: vi.fn()
        .mockReturnValueOnce(oldPeer)
        .mockReturnValueOnce(newPeer),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    runtime.openPairing({});
    signal.emitMessage({
      type: "client.connect",
      requestId: "req-old",
      hostId: "host-test",
      clientId: oldClient.deviceId,
      clientPublicKeyJwk: oldClient.publicKeyJwk,
      clientPublicKeyFingerprint: oldClient.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-old", oldClient);
    signal.emitMessage({
      type: "client.connect",
      requestId: "req-new",
      hostId: "host-test",
      clientId: newClient.deviceId,
      clientPublicKeyJwk: newClient.publicKeyJwk,
      clientPublicKeyFingerprint: newClient.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-new", newClient);
    slowClose.resolve();
    await flushAsync();

    signal.emitMessage({
      type: "webrtc.offer",
      connectionId: "conn-new",
      sdp: "new-offer-sdp",
    });
    await flushAsync();

    expect(newPeer.remoteDescriptions).toEqual([{ type: "offer", sdp: "new-offer-sdp" }]);
  });
});

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

async function answerConnectionChallenge(
  signal: FakeSignalSocket,
  requestId: string,
  identity: Awaited<ReturnType<typeof createDeviceIdentity>>,
): Promise<void> {
  const challengeMessage = signal.sent.find(
    (message) => message.type === "connection.challenge" && message.requestId === requestId,
  );
  expect(challengeMessage).toBeTruthy();
  const challenge = challengeMessage?.challenge as Parameters<typeof signChallenge>[1];
  const proof = await signChallenge(identity, challenge);
  signal.emitMessage({
    type: "connection.challenge_response",
    requestId,
    hostId: "host-test",
    clientId: identity.deviceId,
    proof,
  });
  await waitFor(() =>
    signal.sent.some((message) => message.type === "connection.accept" && message.requestId === requestId)
  );
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class FakeSignalSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  readonly readyState = 1;
  private readonly listeners = new Map<string, Set<(data?: unknown) => void>>();

  on(event: string, listener: (data?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.emit("close");
  }

  emitMessage(message: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }

  private emit(event: string, data?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }
}

class FakePeerConnection {
  onicecandidate?: (event: { candidate?: unknown }) => void;
  ondatachannel?: (event: { channel: FakeDataChannel }) => void;
  readonly remoteDescriptions: unknown[] = [];
  readonly localDescriptions: unknown[] = [];
  localDescription?: { type: "answer"; sdp: string };

  constructor(private readonly closePromise: Promise<void> = Promise.resolve()) {}

  async setRemoteDescription(description: unknown): Promise<void> {
    this.remoteDescriptions.push(description);
  }

  async createAnswer(): Promise<{ type: "answer"; sdp: string }> {
    return { type: "answer", sdp: "answer-sdp" };
  }

  async setLocalDescription(description: { type: "answer"; sdp: string }): Promise<void> {
    this.localDescription = description;
    this.localDescriptions.push(description);
  }

  async addIceCandidate(): Promise<void> {}

  async close(): Promise<void> {
    await this.closePromise;
  }

  emitDataChannel(channel: FakeDataChannel): void {
    this.ondatachannel?.({ channel });
  }
}

class FakeDataChannel {
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  readonly readyState = "open";
  readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.onclose?.();
  }

  emitMessage(message: string): void {
    this.onmessage?.({ data: message });
  }
}
