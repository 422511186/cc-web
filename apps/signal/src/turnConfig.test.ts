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
