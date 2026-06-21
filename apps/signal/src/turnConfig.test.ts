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
}

describe("Signal TURN config", () => {
  it("loads ICE servers from JSON environment configuration", () => {
    const loadIceServersFromEnv = expectApiFunction("loadIceServersFromEnv");

    expect(loadIceServersFromEnv({
      ICE_SERVERS_JSON: JSON.stringify([
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "turn:relay.example.com:3478", username: "relay-user", credential: "relay-pass" },
      ]),
    })).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:relay.example.com:3478", username: "relay-user", credential: "relay-pass" },
    ]);
  });

  it("loads a single TURN server from simple environment variables", () => {
    const loadIceServersFromEnv = expectApiFunction("loadIceServersFromEnv");

    expect(loadIceServersFromEnv({
      TURN_URL: "turn:relay.example.com:3478",
      TURN_USERNAME: "relay-user",
      TURN_CREDENTIAL: "relay-pass",
    })).toEqual([
      { urls: "turn:relay.example.com:3478", username: "relay-user", credential: "relay-pass" },
    ]);
  });

  it("returns configured ICE servers without exposing business data", () => {
    const createSignalHub = expectApiFunction("createSignalHub");
    const hub = createSignalHub({
      iceServers: [
        {
          urls: "turn:relay.example.com:3478",
          username: "relay-user",
          credential: "relay-pass",
        },
      ],
    });
    const peer = new FakePeer();
    const session = hub.connectPeer(peer);

    session.receive({ type: "turn.get", requestId: "turn-1" });

    expect(peer.sent).toEqual([
      {
        type: "turn.config",
        requestId: "turn-1",
        iceServers: [
          {
            urls: "turn:relay.example.com:3478",
            username: "relay-user",
            credential: "relay-pass",
          },
        ],
      },
    ]);
  });
});
