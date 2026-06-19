import { describe, expect, it } from "vitest";
import * as signal from "./index.js";

const api = signal as Record<string, unknown>;

function expectApiFunction<T extends (...args: any[]) => any>(name: string): T {
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

class FakePeer {
  readonly sent: unknown[] = [];

  send(message: unknown): void {
    this.sent.push(message);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

describe("SignalHub", () => {
  it("tracks host online and removes it when the host connection closes", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub();
    const host = new FakePeer();
    const hostSession = hub.connectPeer(host);

    hostSession.receive({ type: "host.online", hostId: "host-1" });

    expect(hub.isHostOnline("host-1")).toBe(true);

    hostSession.close();

    expect(hub.isHostOnline("host-1")).toBe(false);
  });

  it("forwards a client connection request to an online host and rejects offline hosts", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub();
    const host = new FakePeer();
    const client = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    hostSession.receive({ type: "host.online", hostId: "host-1" });

    clientSession.receive({
      type: "client.connect",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      clientPublicKeyJwk: { kty: "EC", crv: "P-256", x: "client-x", y: "client-y" },
      clientPublicKeyFingerprint: "client-fp",
    });
    clientSession.receive({
      type: "client.connect",
      requestId: "req-2",
      hostId: "missing-host",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
    });

    expect(host.sent).toEqual([
      {
        type: "client.connect",
        requestId: "req-1",
        hostId: "host-1",
        clientId: "phone-1",
        clientPublicKeyJwk: { kty: "EC", crv: "P-256", x: "client-x", y: "client-y" },
        clientPublicKeyFingerprint: "client-fp",
      },
    ]);
    expect(client.sent).toEqual([{ type: "signal.error", requestId: "req-2", reason: "host_offline" }]);
  });

  it("forwards valid pairing requests and rejects missing or expired pairing ids", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    let now = Date.parse("2026-06-18T10:00:00.000Z");
    const hub = createSignalHub({ now: () => now });
    const host = new FakePeer();
    const client = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    hostSession.receive({ type: "host.online", hostId: "host-1" });
    hostSession.receive({
      type: "pairing.open",
      hostId: "host-1",
      pairingId: "pair-1",
      expiresAt: "2026-06-18T10:02:00.000Z",
    });

    clientSession.receive({
      type: "pairing.request",
      requestId: "pair-req-1",
      pairingId: "pair-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
      proof: { signature: "sig" },
    });
    clientSession.receive({
      type: "pairing.request",
      requestId: "pair-req-missing",
      pairingId: "missing",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
      proof: { signature: "sig" },
    });
    now = Date.parse("2026-06-18T10:03:00.000Z");
    clientSession.receive({
      type: "pairing.request",
      requestId: "pair-req-expired",
      pairingId: "pair-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
      proof: { signature: "sig" },
    });

    expect(host.sent).toContainEqual({
      type: "pairing.request",
      requestId: "pair-req-1",
      hostId: "host-1",
      pairingId: "pair-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
      proof: { signature: "sig" },
    });
    expect(client.sent).toEqual([
      { type: "signal.error", requestId: "pair-req-missing", reason: "pairing_not_found" },
      { type: "signal.error", requestId: "pair-req-expired", reason: "pairing_expired" },
    ]);
  });

  it("routes host pairing acceptance back only to the requesting client", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub({ now: () => Date.parse("2026-06-18T10:00:00.000Z") });
    const host = new FakePeer();
    const client = new FakePeer();
    const outsider = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    const outsiderSession = hub.connectPeer(outsider);
    hostSession.receive({ type: "host.online", hostId: "host-1" });
    hostSession.receive({
      type: "pairing.open",
      hostId: "host-1",
      pairingId: "pair-1",
      expiresAt: "2026-06-18T10:02:00.000Z",
    });
    clientSession.receive({
      type: "pairing.request",
      requestId: "pair-req-1",
      pairingId: "pair-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
      proof: { signature: "sig" },
    });

    host.clear();
    client.clear();
    outsider.clear();

    hostSession.receive({
      type: "pairing.accept",
      requestId: "pair-req-1",
      hostId: "host-1",
      clientId: "phone-1",
    });
    outsiderSession.receive({
      type: "pairing.accept",
      requestId: "pair-req-1",
      hostId: "host-1",
      clientId: "phone-1",
    });

    expect(client.sent).toEqual([
      {
        type: "pairing.accepted",
        requestId: "pair-req-1",
        hostId: "host-1",
        clientId: "phone-1",
      },
    ]);
    expect(host.sent).toEqual([]);
    expect(outsider.sent).toEqual([{ type: "signal.error", requestId: "pair-req-1", reason: "pairing_not_found" }]);
  });

  it("forwards offer, answer, and candidate only between participants of the accepted connection", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub();
    const host = new FakePeer();
    const client = new FakePeer();
    const outsider = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    const outsiderSession = hub.connectPeer(outsider);
    hostSession.receive({ type: "host.online", hostId: "host-1" });
    clientSession.receive({
      type: "client.connect",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
    });
    hostSession.receive({
      type: "connection.accept",
      requestId: "req-1",
      connectionId: "conn-1",
      clientId: "phone-1",
    });
    host.clear();
    client.clear();

    clientSession.receive({ type: "webrtc.offer", connectionId: "conn-1", sdp: "offer-sdp" });
    hostSession.receive({ type: "webrtc.answer", connectionId: "conn-1", sdp: "answer-sdp" });
    clientSession.receive({ type: "webrtc.candidate", connectionId: "conn-1", candidate: "candidate-1" });
    outsiderSession.receive({ type: "webrtc.candidate", connectionId: "conn-1", candidate: "candidate-x" });

    expect(host.sent).toEqual([
      { type: "webrtc.offer", connectionId: "conn-1", from: "client", sdp: "offer-sdp" },
      { type: "webrtc.candidate", connectionId: "conn-1", from: "client", candidate: "candidate-1" },
    ]);
    expect(client.sent).toEqual([{ type: "webrtc.answer", connectionId: "conn-1", from: "host", sdp: "answer-sdp" }]);
    expect(outsider.sent).toEqual([{ type: "signal.error", reason: "not_connection_participant" }]);
  });

  it("forwards connection challenge and signed response only between the pending participants", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub();
    const host = new FakePeer();
    const client = new FakePeer();
    const outsider = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    const outsiderSession = hub.connectPeer(outsider);
    hostSession.receive({ type: "host.online", hostId: "host-1" });
    clientSession.receive({
      type: "client.connect",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      clientPublicKeyFingerprint: "client-fp",
    });
    host.clear();
    client.clear();
    outsider.clear();

    hostSession.receive({
      type: "connection.challenge",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      challenge: { protocol: "coderelay-challenge-v1", challengeId: "challenge-1" },
    });
    clientSession.receive({
      type: "connection.challenge_response",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      proof: { protocol: "coderelay-challenge-proof-v1", challengeId: "challenge-1" },
    });
    outsiderSession.receive({
      type: "connection.challenge_response",
      requestId: "req-1",
      hostId: "host-1",
      clientId: "phone-1",
      proof: { protocol: "coderelay-challenge-proof-v1", challengeId: "challenge-1" },
    });

    expect(client.sent).toEqual([
      {
        type: "connection.challenge",
        requestId: "req-1",
        hostId: "host-1",
        clientId: "phone-1",
        challenge: { protocol: "coderelay-challenge-v1", challengeId: "challenge-1" },
      },
    ]);
    expect(host.sent).toEqual([
      {
        type: "connection.challenge_response",
        requestId: "req-1",
        hostId: "host-1",
        clientId: "phone-1",
        proof: { protocol: "coderelay-challenge-proof-v1", challengeId: "challenge-1" },
      },
    ]);
    expect(outsider.sent).toEqual([{ type: "signal.error", requestId: "req-1", reason: "connection_not_found" }]);
  });

  it("rejects business API messages instead of forwarding them", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub();
    const host = new FakePeer();
    const client = new FakePeer();
    const hostSession = hub.connectPeer(host);
    const clientSession = hub.connectPeer(client);
    hostSession.receive({ type: "host.online", hostId: "host-1" });
    host.clear();

    clientSession.receive({ type: "api.request", requestId: "biz-1", path: "/api/projects" });

    expect(client.sent).toEqual([{ type: "signal.error", requestId: "biz-1", reason: "unsupported_message" }]);
    expect(host.sent).toEqual([]);
  });
});
