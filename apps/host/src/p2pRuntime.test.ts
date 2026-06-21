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
    expect(signal.sent).toContainEqual(expect.objectContaining({
      type: "pairing.open",
      hostId: "host-test",
      pairCode: expect.any(String),
      pairingId: "pair-test",
      offer: expect.objectContaining({ pairingId: "pair-test" }),
      expiresAt: "2026-06-19T00:02:00.000Z",
    }));
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
    expect(pairing.pairingUrl).toMatch(/^http:\/\/web\.test\/pair\/[A-Z0-9]+\?v=pair-test#signal=ws%3A%2F%2Fsignal\.test%2F$/);
    expect(pairing.pairingUrl).not.toContain("p2p=");
  });

  it("opens a pairing with a short /pair code URL instead of embedding the full offer", async () => {
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
      createPairingCode: () => "ABCD12",
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    const pairing = runtime.openPairing({});

    expect(pairing.pairingUrl).toBe("http://web.test/pair/ABCD12?v=pair-test#signal=ws%3A%2F%2Fsignal.test%2F");
    expect(pairing.pairingUrl).not.toContain("p2p=");
    expect(pairing.pairCode).toBe("ABCD12");
    expect(signal.sent).toContainEqual(expect.objectContaining({
      type: "pairing.open",
      pairCode: "ABCD12",
      offer: pairing.offer,
    }));
  });

  it("keeps Signal URL in the hash when the Web URL already has a base path", async () => {
    const runtime = new HostP2PRuntime({
      signalUrl: "wss://signal.example.com/coderelay-signal/",
      hostId: "host-test",
      webUrl: "https://coderelay-web.vercel.app/app/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      createPairingCode: () => "CODE12",
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createSignalSocket: () => new FakeSignalSocket(),
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    const pairing = runtime.openPairing({});

    expect(pairing.pairingUrl).toBe(
      "https://coderelay-web.vercel.app/app/pair/CODE12?v=pair-test#signal=wss%3A%2F%2Fsignal.example.com%2Fcoderelay-signal%2F"
    );
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

  it("reconnects to Signal after disconnect and republishes the active pairing", async () => {
    const firstSignal = new FakeSignalSocket();
    const secondSignal = new FakeSignalSocket();
    const sockets = [firstSignal, secondSignal];
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createSignalSocket: () => sockets.shift() ?? new FakeSignalSocket(),
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
      signalReconnectDelayMs: 0,
    });

    await runtime.start();
    runtime.openPairing({});
    firstSignal.close();

    await waitFor(() => secondSignal.sent.some((message) => message.type === "host.online"));
    expect(secondSignal.sent).toContainEqual({ type: "host.online", hostId: "host-test" });
    expect(secondSignal.sent).toContainEqual(expect.objectContaining({
      type: "pairing.open",
      hostId: "host-test",
      pairCode: expect.any(String),
      pairingId: "pair-test",
      offer: expect.objectContaining({ pairingId: "pair-test" }),
      expiresAt: "2026-06-19T00:02:00.000Z",
    }));
    expect(runtime.getStatus()).toEqual(
      expect.objectContaining({
        signalStatus: "connected",
        activePairing: expect.objectContaining({ pairingId: "pair-test" }),
      })
    );
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
      displayName: "Chrome on Android",
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
            displayName: "Chrome on Android",
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

  it("reports trusted device usage, P2P transport type, and topology for the Host management page", async () => {
    let now = Date.parse("2026-06-19T00:00:00.000Z");
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
      trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
        clientId: clientIdentity.deviceId,
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        displayName: "Huang Phone",
        addedAt: "2026-06-19T00:00:00.000Z",
      }),
      onTrustedDeviceStoreChanged: (store: unknown) => persistedStores.push(store),
      now: () => now,
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    await runtime.start();
    now = Date.parse("2026-06-19T00:05:00.000Z");
    signal.emitMessage({
      type: "client.connect",
      requestId: "req-client",
      hostId: "host-test",
      clientId: clientIdentity.deviceId,
      clientPublicKeyJwk: clientIdentity.publicKeyJwk,
      clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-client", clientIdentity);

    expect(runtime.getManagementState()).toEqual({
      devices: [
        expect.objectContaining({
          clientId: "client-phone",
          displayName: "Huang Phone",
          addedAt: "2026-06-19T00:00:00.000Z",
          lastUsedAt: "2026-06-19T00:05:00.000Z",
          lastTransport: "p2p",
          revokedAt: undefined,
        }),
      ],
      topology: expect.objectContaining({
        signalUrl: "ws://signal.test/",
        hostId: "host-test",
        signalStatus: "connected",
        peerStatus: "connecting",
        activeConnection: {
          clientId: "client-phone",
          connectionId: "conn-test",
          transport: "p2p",
          route: "WebRTC DataChannel -> Host local HTTP bridge",
        },
      }),
    });
    expect(persistedStores.at(-1)).toEqual(
      expect.objectContaining({
        trustedClients: [
          expect.objectContaining({
            clientId: "client-phone",
            lastUsedAt: "2026-06-19T00:05:00.000Z",
            lastTransport: "p2p",
          }),
        ],
      })
    );

    expect(await runtime.revokeDevice("client-phone")).toEqual({ ok: true, clientId: "client-phone" });
    expect(runtime.getManagementState().devices[0]).toEqual(
      expect.objectContaining({
        clientId: "client-phone",
        revokedAt: "2026-06-19T00:05:00.000Z",
      })
    );
  });

  it("reports configured TURN topology without exposing credentials", async () => {
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      iceServers: [{ urls: "turn:relay.example.com:3478", username: "u", credential: "secret" }],
      iceLocalAddresses: ["172.30.1.2"],
      createSignalSocket: () => new FakeSignalSocket(),
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    expect(runtime.getManagementState().topology).toEqual(expect.objectContaining({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      iceLocalAddresses: ["172.30.1.2"],
      turnConfigured: true,
      iceServers: [{ urls: "turn:relay.example.com:3478", hasUsername: true, hasCredential: true }],
    }));
    expect(JSON.stringify(runtime.getManagementState().topology)).not.toContain("secret");
  });

  it("updates public Web and Signal URLs used by new pairings", async () => {
    const signal = new FakeSignalSocket();
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://old-signal.test/",
      hostId: "host-test",
      webUrl: "http://old-web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      createPairingCode: () => "ABCD12",
      createPairingId: () => "pair-test",
      createPairingSecret: () => "secret-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => new FakePeerConnection(),
      createBridge: vi.fn(() => ({ close: vi.fn() })),
    });

    runtime.updateSettings({
      webUrl: "http://new-web.test/app",
      signalUrl: "ws://new-signal.test/",
    });
    const pairing = runtime.openPairing({});

    expect(runtime.getSettings()).toEqual({
      webUrl: "http://new-web.test/app",
      signalUrl: "ws://new-signal.test/",
    });
    expect(pairing.pairingUrl).toBe("http://new-web.test/app/pair/ABCD12?v=pair-test#signal=ws%3A%2F%2Fnew-signal.test%2F");
    expect(pairing.offer.webUrl).toBe("http://new-web.test/app");
    expect(pairing.offer.signalUrl).toBe("ws://new-signal.test/");
    expect(runtime.getManagementState().topology.signalUrl).toBe("ws://new-signal.test/");
  });

  it("sends device_revoked before closing an active peer", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const peer = new FakePeerConnection();
    const channel = new FakeDataChannel();
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      trustedDeviceStore: trustClient(createTrustedDeviceStore(), {
        clientId: clientIdentity.deviceId,
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        displayName: "Chrome on Android",
        addedAt: "2026-06-19T00:00:00.000Z",
      }),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createConnectionId: () => "conn-test",
      createSignalSocket: () => signal,
      createPeerConnection: () => peer,
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
    await answerConnectionChallenge(signal, "req-client", clientIdentity);
    peer.emitDataChannel(channel);
    await flushAsync();

    await runtime.revokeDevice("client-phone");

    expect(channel.sent.map((raw) => JSON.parse(raw))).toContainEqual({
      type: "event",
      event: {
        type: "device_revoked",
        message: "此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。",
      },
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

  it("keeps multiple authorized devices online without closing earlier P2P connections", async () => {
    const firstClient = await createDeviceIdentity({
      deviceId: "client-phone-a",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const secondClient = await createDeviceIdentity({
      deviceId: "client-phone-b",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const firstPeer = new FakePeerConnection();
    const secondPeer = new FakePeerConnection();
    const firstBridge = { close: vi.fn() };
    const secondBridge = { close: vi.fn() };
    const createBridge = vi.fn()
      .mockReturnValueOnce(firstBridge)
      .mockReturnValueOnce(secondBridge);
    const runtime = new HostP2PRuntime({
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      webUrl: "http://web.test/",
      localApiBaseUrl: "http://127.0.0.1:3002/api",
      authToken: "test-token-123456",
      trustedDeviceStore: trustClient(
        trustClient(createTrustedDeviceStore(), {
          clientId: firstClient.deviceId,
          clientPublicKeyJwk: firstClient.publicKeyJwk,
          addedAt: "2026-06-19T00:00:00.000Z",
        }),
        {
          clientId: secondClient.deviceId,
          clientPublicKeyJwk: secondClient.publicKeyJwk,
          addedAt: "2026-06-19T00:00:00.000Z",
        },
      ),
      now: () => Date.parse("2026-06-19T00:00:00.000Z"),
      createConnectionId: vi.fn()
        .mockReturnValueOnce("conn-a")
        .mockReturnValueOnce("conn-b"),
      createSignalSocket: () => signal,
      createPeerConnection: vi.fn()
        .mockReturnValueOnce(firstPeer)
        .mockReturnValueOnce(secondPeer),
      createBridge,
    });

    await runtime.start();
    signal.emitMessage({
      type: "client.connect",
      requestId: "req-a",
      hostId: "host-test",
      clientId: firstClient.deviceId,
      clientPublicKeyJwk: firstClient.publicKeyJwk,
      clientPublicKeyFingerprint: firstClient.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-a", firstClient);
    const firstChannel = new FakeDataChannel();
    firstPeer.emitDataChannel(firstChannel);
    await flushAsync();

    signal.emitMessage({
      type: "client.connect",
      requestId: "req-b",
      hostId: "host-test",
      clientId: secondClient.deviceId,
      clientPublicKeyJwk: secondClient.publicKeyJwk,
      clientPublicKeyFingerprint: secondClient.publicKeyFingerprint,
    });
    await answerConnectionChallenge(signal, "req-b", secondClient);
    const secondChannel = new FakeDataChannel();
    secondPeer.emitDataChannel(secondChannel);
    await flushAsync();

    expect(firstPeer.closeCalls).toBe(0);
    expect(firstBridge.close).not.toHaveBeenCalled();
    expect(secondPeer.closeCalls).toBe(0);
    expect(secondBridge.close).not.toHaveBeenCalled();
    expect(createBridge).toHaveBeenCalledTimes(2);

    const [firstPort] = createBridge.mock.calls[0];
    const [secondPort] = createBridge.mock.calls[1];
    firstPort.send("host to first");
    secondPort.send("host to second");

    expect(firstChannel.sent).toEqual(["host to first"]);
    expect(secondChannel.sent).toEqual(["host to second"]);
    expect(runtime.getManagementState().topology.activeConnections).toEqual([
      expect.objectContaining({ clientId: "client-phone-a", connectionId: "conn-a" }),
      expect.objectContaining({ clientId: "client-phone-b", connectionId: "conn-b" }),
    ]);
  });

  it("rejects untrusted reconnect attempts explicitly instead of leaving the client waiting for a challenge", async () => {
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
      trustedDeviceStore: createTrustedDeviceStore(),
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

    expect(signal.sent).toContainEqual({
      type: "connection.reject",
      requestId: "req-client",
      hostId: "host-test",
      clientId: "client-phone",
      reason: "untrusted_client",
    });
    expect(signal.sent).not.toContainEqual(expect.objectContaining({ type: "connection.challenge" }));
  });

  it("emits WebRTC diagnostics for connection evidence", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const signal = new FakeSignalSocket();
    const peer = new FakePeerConnection();
    const diagnostics: unknown[] = [];
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
      createPeerConnection: () => peer,
      createBridge: vi.fn(() => ({ close: vi.fn() })),
      onDiagnostic: (event) => diagnostics.push(event),
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
    await answerConnectionChallenge(signal, "req-client", clientIdentity);
    signal.emitMessage({
      type: "webrtc.candidate",
      connectionId: "conn-test",
      candidate: { candidate: "candidate:remote typ srflx", type: "srflx" },
    });
    signal.emitMessage({
      type: "webrtc.offer",
      connectionId: "conn-test",
      sdp: "offer-sdp",
    });
    peer.onicecandidate?.({ candidate: { candidate: "candidate:local typ host", type: "host" } });
    peer.emitDataChannel(new FakeDataChannel());
    await flushAsync();

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "p2p.connection.accepted", connectionId: "conn-test", clientId: "client-phone" }),
        expect.objectContaining({ event: "p2p.webrtc.remote-candidate", connectionId: "conn-test", candidateType: "srflx" }),
        expect.objectContaining({ event: "p2p.webrtc.offer.received", connectionId: "conn-test", sdpBytes: 9 }),
        expect.objectContaining({ event: "p2p.webrtc.answer.sent", connectionId: "conn-test", sdpBytes: 10 }),
        expect.objectContaining({ event: "p2p.webrtc.local-candidate", connectionId: "conn-test", candidateType: "host" }),
        expect.objectContaining({ event: "p2p.datachannel.open", connectionId: "conn-test", clientId: "client-phone" }),
      ])
    );
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
  closeCalls = 0;
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
    this.closeCalls += 1;
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
