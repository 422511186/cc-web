import { describe, expect, it, vi } from "vitest";
import { createChallenge, createDeviceIdentity } from "@coderelay/p2p-core";
import { connectBrowserP2P, decodePairingOfferFromUrl } from "./p2pClient";

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

    const response = session.transport.request<{ ok: boolean }>({
      method: "GET",
      path: "/projects",
    });
    await waitFor(() => channel.sent.some((message) => JSON.parse(message).type === "request"));
    const requestFrame = JSON.parse(channel.sent.at(-1) ?? "{}") as { id: string };
    channel.message(JSON.stringify({ type: "response", id: requestFrame.id, status: 200, body: { ok: true } }));

    await expect(response).resolves.toEqual({ ok: true });
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
