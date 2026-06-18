import { describe, expect, it } from "vitest";
import { RTCPeerConnection } from "werift";

async function loadApi(): Promise<Record<string, unknown>> {
  try {
    return (await import("./webrtcNode.js")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function expectApiFunction<T extends (...args: any[]) => any>(name: string): Promise<T> {
  const api = await loadApi();
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("Node WebRTC TURN configuration", () => {
  it("fails clearly when relay is required but no TURN server is configured", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");

    await expect(createWeriftDataChannelPair({ requireRelay: true, iceServers: [] })).rejects.toThrow(
      "TURN relay is required but no TURN servers were configured",
    );
  });

  it("passes configured ICE servers into both peer connections", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");
    const configs: unknown[] = [];

    const pair = await createWeriftDataChannelPair({
      iceServers: [
        {
          urls: "turn:relay.example.com:3478",
          username: "relay-user",
          credential: "relay-pass",
        },
      ],
      peerConnectionFactory: (config: unknown) => {
        configs.push(config);
        return new RTCPeerConnection({
          ...(config as ConstructorParameters<typeof RTCPeerConnection>[0]),
          iceServers: [],
        });
      },
    });

    try {
      expect(configs).toEqual([
        expect.objectContaining({
          iceServers: [
            {
              urls: "turn:relay.example.com:3478",
              username: "relay-user",
              credential: "relay-pass",
            },
          ],
          iceTransportPolicy: "all",
        }),
        expect.objectContaining({
          iceServers: [
            {
              urls: "turn:relay.example.com:3478",
              username: "relay-user",
              credential: "relay-pass",
            },
          ],
          iceTransportPolicy: "all",
        }),
      ]);
    } finally {
      await pair.close();
    }
  }, 30_000);
});
