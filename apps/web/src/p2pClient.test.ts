import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChallenge, createDeviceIdentity, createTrustedDeviceStore, trustHost } from "@coderelay/p2p-core";
import { connectBrowserP2P, connectBrowserP2PFromPairCode, decodePairingOfferFromUrl } from "./p2pClient";

beforeEach(() => {
  localStorage.clear();
});

describe("decodePairingOfferFromUrl", () => {
  it("decodes the p2p pairing offer from a scanned URL", () => {
    const offer = {
      protocol: "coderelay-pairing-v1",
      webUrl: "http://web.test/",
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      hostPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "host-x",
        y: "host-y",
      },
      hostPublicKeyFingerprint: "host-fingerprint",
      pairingId: "pair-test",
      pairingSecret: "secret-test",
      expiresAt: "2999-06-19T00:02:00.000Z",
    };
    const encoded = btoa(JSON.stringify(offer)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

    expect(decodePairingOfferFromUrl(`http://web.test/?p2p=${encoded}`)).toEqual(offer);
  });
});

describe("connectBrowserP2P", () => {
  it("looks up a short pair code and sends a friendly device name", async () => {
    const socket = new FakeWebSocket();
    const sessionPromise = connectBrowserP2PFromPairCode("ABCD12", {
      signalUrl: "ws://signal.test/",
      createWebSocket: () => {
        queueMicrotask(() => socket.open());
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => new FakePeerConnection(new FakeDataChannel()) as unknown as RTCPeerConnection,
      detectDeviceName: () => "Chrome on Android",
      timeoutMs: 1000,
    });

    await waitFor(() => socket.sent.some((message) => message.type === "pairing.lookup"));
    const lookup = socket.sent.find((message) => message.type === "pairing.lookup");
    expect(lookup).toEqual({
      type: "pairing.lookup",
      requestId: expect.any(String),
      pairCode: "ABCD12",
    });

    socket.message({
      type: "pairing.offer",
      requestId: lookup?.requestId,
      offer: pairingOffer(),
    });

    await waitFor(() => socket.sent.some((message) => message.type === "pairing.request"));
    expect(socket.sent.find((message) => message.type === "pairing.request")).toEqual(
      expect.objectContaining({ displayName: "Chrome on Android" })
    );

    await expect(sessionPromise).rejects.toThrow("等待 Host 接受设备配对超时");
  });

  it("connects on browsers that do not provide crypto.randomUUID", async () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    localStorage.clear();
    const socket = new FakeWebSocket();

    try {
      const sessionPromise = connectBrowserP2P(pairingOffer(), {
        createWebSocket: () => {
          queueMicrotask(() => socket.open());
          return socket as unknown as WebSocket;
        },
        createPeerConnection: () => new FakePeerConnection(new FakeDataChannel()) as unknown as RTCPeerConnection,
        timeoutMs: 1000,
      });

      await waitFor(() => socket.sent.some((message) => message.type === "pairing.request"));
      expect(socket.sent.find((message) => message.type === "pairing.request")).toEqual(
        expect.objectContaining({
          requestId: expect.stringMatching(/^pair-/),
          clientId: expect.stringMatching(/^client-/),
        })
      );
      expect(localStorage.getItem("coderelay-client-id")).toMatch(/^client-/);

      await expect(sessionPromise).rejects.toThrow("等待 Host 接受设备配对超时");
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it("connects through Signal, opens a WebRTC DataChannel, and returns a P2P transport", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const socket = new FakeWebSocket();
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    const createRequestId = vi.fn()
      .mockReturnValueOnce("pair-req-phone")
      .mockReturnValueOnce("connect-req-phone");
    const sessionPromise = connectBrowserP2P(pairingOffer(), {
      createWebSocket: (url) => {
        expect(url).toBe("ws://signal.test/");
        queueMicrotask(() => socket.open());
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      loadClientIdentity: () => Promise.resolve(clientIdentity),
      createRequestId,
      timeoutMs: 1000,
    });

    await waitFor(() =>
      socket.sent.some((message) => message.type === "pairing.request" && message.clientId === "client-phone")
    );
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "pairing.request",
        requestId: "pair-req-phone",
        pairingId: "pair-test",
        clientId: "client-phone",
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
        proof: expect.objectContaining({
          protocol: "coderelay-pairing-proof-v1",
          pairingId: "pair-test",
          clientId: "client-phone",
        }),
      })
    );
    expect(socket.sent.some((message) => message.type === "client.connect")).toBe(false);

    socket.message({
      type: "pairing.accepted",
      requestId: "pair-req-phone",
      hostId: "host-test",
      clientId: "client-phone",
    });

    await waitFor(() =>
      socket.sent.some((message) => message.type === "client.connect" && message.clientId === "client-phone")
    );
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "client.connect",
        requestId: "connect-req-phone",
        hostId: "host-test",
        clientId: "client-phone",
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
      })
    );
    const challenge = createChallenge({
      challengeId: "challenge-phone",
      nonce: "nonce-phone",
      issuedAt: "2026-06-19T00:00:00.000Z",
    });
    socket.message({
      type: "connection.challenge",
      requestId: "connect-req-phone",
      hostId: "host-test",
      clientId: "client-phone",
      challenge,
    });

    await waitFor(
      () => socket.sent.some((message) => message.type === "connection.challenge_response"),
      () => socket.sent,
    );
    const challengeResponse = socket.sent.find((message) => message.type === "connection.challenge_response");
    expect(challengeResponse).toEqual(
      expect.objectContaining({
        type: "connection.challenge_response",
        requestId: "connect-req-phone",
        hostId: "host-test",
        clientId: "client-phone",
        proof: expect.objectContaining({
          protocol: "coderelay-challenge-proof-v1",
          deviceId: "client-phone",
          challengeId: "challenge-phone",
        }),
      })
    );
    socket.message({
      type: "connection.accepted",
      requestId: "connect-req-phone",
      connectionId: "conn-test",
      hostId: "host-test",
      clientId: "client-phone",
    });

    await waitFor(() => socket.sent.some((message) => message.type === "webrtc.offer"));
    expect(peer.localDescriptions).toEqual([{ type: "offer", sdp: "offer-sdp" }]);
    expect(socket.sent).toContainEqual({
      type: "webrtc.offer",
      connectionId: "conn-test",
      sdp: "offer-sdp",
    });

    socket.message({
      type: "webrtc.answer",
      connectionId: "conn-test",
      sdp: "answer-sdp",
    });
    channel.open();

    const session = await sessionPromise;
    expect(peer.remoteDescriptions).toEqual([{ type: "answer", sdp: "answer-sdp" }]);
    expect(session.connectionId).toBe("conn-test");
    expect(JSON.parse(localStorage.getItem("coderelay-last-trusted-host-v1") ?? "null")).toEqual({
      protocol: "coderelay-trusted-host-v1",
      webUrl: "http://web.test/",
      signalUrl: "ws://signal.test/",
      hostId: "host-test",
      hostPublicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "host-x",
        y: "host-y",
      },
      hostPublicKeyFingerprint: "host-fingerprint",
      updatedAt: expect.any(String),
    });

    const response = session.transport.request<{ ok: boolean }>({
      method: "GET",
      path: "/projects",
    });
    await waitFor(() => channel.sent.some((message) => JSON.parse(message).type === "request"));
    const requestFrame = JSON.parse(channel.sent.at(-1) ?? "{}") as { id: string };
    channel.message(JSON.stringify({ type: "response", id: requestFrame.id, status: 200, body: { ok: true } }));

    await expect(response).resolves.toEqual({ ok: true });
  });

  it("fails pairing immediately when Signal reports that the Host is offline", async () => {
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    const socket = new FakeWebSocket();
    const createRequestId = vi.fn()
      .mockReturnValueOnce("pair-req-phone")
      .mockReturnValueOnce("connect-req-phone");
    const sessionPromise = connectBrowserP2P(pairingOffer(), {
      createWebSocket: () => {
        queueMicrotask(() => socket.open());
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => new FakePeerConnection(new FakeDataChannel()) as unknown as RTCPeerConnection,
      loadClientIdentity: () => Promise.resolve(clientIdentity),
      createRequestId,
      timeoutMs: 1000,
    });

    await waitFor(() => socket.sent.some((message) => message.type === "pairing.request"));
    socket.message({
      type: "signal.error",
      requestId: "pair-req-phone",
      reason: "host_offline",
    });

    await expect(sessionPromise).rejects.toThrow("Host 当前未连接到 CodeRelay Signal");
  });

  it("reconnects to a previously trusted Host without opening a new pairing", async () => {
    const p2pClient = await import("./p2pClient") as Record<string, unknown>;
    const connectTrustedBrowserP2P = p2pClient.connectTrustedBrowserP2P as (
      profile: ReturnType<typeof trustedHostProfile>,
      options: Parameters<typeof connectBrowserP2P>[1],
    ) => ReturnType<typeof connectBrowserP2P>;
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    localStorage.setItem(
      "coderelay-trusted-device-store-v1",
      JSON.stringify(
        trustHost(createTrustedDeviceStore(), {
          hostId: "host-test",
          hostPublicKeyJwk: pairingOffer().hostPublicKeyJwk,
          displayName: "host-test",
        })
      )
    );
    const socket = new FakeWebSocket();
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    const createRequestId = vi.fn().mockReturnValueOnce("connect-req-phone");

    const sessionPromise = connectTrustedBrowserP2P(trustedHostProfile(), {
      createWebSocket: (url) => {
        expect(url).toBe("ws://signal.test/");
        queueMicrotask(() => socket.open());
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      loadClientIdentity: () => Promise.resolve(clientIdentity),
      createRequestId,
      timeoutMs: 1000,
    });

    await waitFor(() =>
      socket.sent.some((message) => message.type === "client.connect" && message.clientId === "client-phone")
    );
    expect(socket.sent.some((message) => message.type === "pairing.request")).toBe(false);
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: "client.connect",
        requestId: "connect-req-phone",
        hostId: "host-test",
        clientId: "client-phone",
        clientPublicKeyJwk: clientIdentity.publicKeyJwk,
        clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
      })
    );

    const challenge = createChallenge({
      challengeId: "challenge-phone",
      nonce: "nonce-phone",
      issuedAt: "2026-06-19T00:00:00.000Z",
    });
    socket.message({
      type: "connection.challenge",
      requestId: "connect-req-phone",
      hostId: "host-test",
      clientId: "client-phone",
      challenge,
    });
    await waitFor(() => socket.sent.some((message) => message.type === "connection.challenge_response"));
    socket.message({
      type: "connection.accepted",
      requestId: "connect-req-phone",
      connectionId: "conn-test",
      hostId: "host-test",
      clientId: "client-phone",
    });
    await waitFor(() => socket.sent.some((message) => message.type === "webrtc.offer"));
    socket.message({
      type: "webrtc.answer",
      connectionId: "conn-test",
      sdp: "answer-sdp",
    });
    channel.open();

    await expect(sessionPromise).resolves.toEqual(expect.objectContaining({
      connectionId: "conn-test",
      clientId: "client-phone",
    }));
  });

  it("clears trusted host state and notifies when Host revokes this device", async () => {
    const p2pClient = await import("./p2pClient") as Record<string, unknown>;
    const connectTrustedBrowserP2P = p2pClient.connectTrustedBrowserP2P as (
      profile: ReturnType<typeof trustedHostProfile>,
      options: Parameters<typeof connectBrowserP2P>[1],
    ) => ReturnType<typeof connectBrowserP2P>;
    const clientIdentity = await createDeviceIdentity({
      deviceId: "client-phone",
      createdAt: "2026-06-19T00:00:00.000Z",
    });
    localStorage.setItem(
      "coderelay-trusted-device-store-v1",
      JSON.stringify(
        trustHost(createTrustedDeviceStore(), {
          hostId: "host-test",
          hostPublicKeyJwk: pairingOffer().hostPublicKeyJwk,
          displayName: "host-test",
        })
      )
    );
    localStorage.setItem("coderelay-last-trusted-host-v1", JSON.stringify(trustedHostProfile()));
    const socket = new FakeWebSocket();
    const channel = new FakeDataChannel();
    const peer = new FakePeerConnection(channel);
    const onDeviceRevoked = vi.fn();
    const sessionPromise = connectTrustedBrowserP2P(trustedHostProfile(), {
      createWebSocket: () => {
        queueMicrotask(() => socket.open());
        return socket as unknown as WebSocket;
      },
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      loadClientIdentity: () => Promise.resolve(clientIdentity),
      createRequestId: vi.fn().mockReturnValueOnce("connect-req-phone"),
      onDeviceRevoked,
      timeoutMs: 1000,
    });

    await waitFor(() => socket.sent.some((message) => message.type === "client.connect"));
    socket.message({
      type: "connection.challenge",
      requestId: "connect-req-phone",
      hostId: "host-test",
      clientId: "client-phone",
      challenge: createChallenge({ challengeId: "challenge-phone" }),
    });
    await waitFor(() => socket.sent.some((message) => message.type === "connection.challenge_response"));
    socket.message({
      type: "connection.accepted",
      requestId: "connect-req-phone",
      connectionId: "conn-test",
      hostId: "host-test",
      clientId: "client-phone",
    });
    await waitFor(() => socket.sent.some((message) => message.type === "webrtc.offer"));
    socket.message({
      type: "webrtc.answer",
      connectionId: "conn-test",
      sdp: "answer-sdp",
    });
    channel.open();
    await sessionPromise;

    channel.message(JSON.stringify({
      type: "event",
      event: {
        type: "device_revoked",
        message: "此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。",
      },
    }));

    expect(onDeviceRevoked).toHaveBeenCalledWith("此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。");
    expect(localStorage.getItem("coderelay-last-trusted-host-v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("coderelay-trusted-device-store-v1") ?? "{}").trustedHosts).toEqual([]);
  });
});

function pairingOffer() {
  return {
    protocol: "coderelay-pairing-v1" as const,
    webUrl: "http://web.test/",
    signalUrl: "ws://signal.test/",
    hostId: "host-test",
    hostPublicKeyFingerprint: "host-fingerprint",
    hostPublicKeyJwk: {
      kty: "EC",
      crv: "P-256",
      x: "host-x",
      y: "host-y",
    },
    pairingId: "pair-test",
    pairingSecret: "secret-test",
    expiresAt: "2999-06-19T00:02:00.000Z",
  };
}

function trustedHostProfile() {
  const offer = pairingOffer();
  return {
    protocol: "coderelay-trusted-host-v1" as const,
    webUrl: offer.webUrl,
    signalUrl: offer.signalUrl,
    hostId: offer.hostId,
    hostPublicKeyJwk: offer.hostPublicKeyJwk,
    hostPublicKeyFingerprint: offer.hostPublicKeyFingerprint,
    updatedAt: "2026-06-19T00:00:00.000Z",
  };
}

class FakeWebSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  message(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class FakePeerConnection {
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null = null;
  readonly localDescriptions: unknown[] = [];
  readonly remoteDescriptions: unknown[] = [];
  localDescription: { type: "offer"; sdp: string } | null = null;

  constructor(private readonly channel: FakeDataChannel) {}

  createDataChannel(label: string): FakeDataChannel {
    expect(label).toBe("coderelay");
    return this.channel;
  }

  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async setLocalDescription(description: { type: "offer"; sdp: string }): Promise<void> {
    this.localDescription = description;
    this.localDescriptions.push(description);
  }

  async setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void> {
    this.remoteDescriptions.push(description);
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {}
}

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }

  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  message(message: string): void {
    this.onmessage?.({ data: message });
  }
}

async function waitFor(predicate: () => boolean, debug?: () => unknown): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for predicate: ${JSON.stringify(debug?.() ?? null)}`);
}
