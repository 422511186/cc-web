import { describe, expect, it } from "vitest";

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

describe("Node WebRTC DataChannel pair", () => {
  it("establishes a DataChannel and sends request/response over it", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");
    const pair = await createWeriftDataChannelPair();

    try {
      pair.host.handleRequests(async (request: { body: unknown }) => ({
        ok: true,
        echo: request.body,
      }));

      await expect(pair.client.request({ path: "/api/projects" })).resolves.toEqual({
        ok: true,
        echo: { path: "/api/projects" },
      });
      expect(pair.client.peerStatus).toBe("connected");
      expect(pair.host.peerStatus).toBe("connected");
    } finally {
      await pair.close();
    }
  }, 30_000);

  it("keeps request/response usable when Signal is disconnected but peer is still connected", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");
    const pair = await createWeriftDataChannelPair();

    try {
      pair.host.handleRequests(async () => ({ ok: true }));
      pair.client.setSignalStatus("disconnected");
      pair.host.setSignalStatus("disconnected");

      expect(pair.client.signalStatus).toBe("disconnected");
      expect(pair.client.peerStatus).toBe("connected");
      await expect(pair.client.request({ path: "/api/projects" })).resolves.toEqual({ ok: true });
    } finally {
      await pair.close();
    }
  }, 30_000);

  it("marks peers unavailable when the DataChannel closes", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");
    const pair = await createWeriftDataChannelPair();

    try {
      pair.client.closeDataChannel();
      await waitFor(() => pair.client.peerStatus === "disconnected");

      expect(pair.client.peerStatus).toBe("disconnected");
      await expect(pair.client.request({ path: "/api/projects" })).rejects.toThrow(
        "P2P data channel is not connected",
      );
    } finally {
      await pair.close();
    }
  }, 30_000);

  it("can reconnect after Signal recovers and reuse the same logical peer objects", async () => {
    const createWeriftDataChannelPair = await expectApiFunction("createWeriftDataChannelPair");
    const pair = await createWeriftDataChannelPair();

    try {
      pair.host.handleRequests(async (request: { body: unknown }) => request.body);
      pair.client.setSignalStatus("disconnected");
      pair.client.closeDataChannel();
      await waitFor(() => pair.client.peerStatus === "disconnected");

      pair.client.setSignalStatus("connected");
      pair.host.setSignalStatus("connected");
      await pair.reconnect();

      expect(pair.client.peerStatus).toBe("connected");
      expect(pair.client.signalStatus).toBe("connected");
      await expect(pair.client.request({ path: "/api/sessions" })).resolves.toEqual({ path: "/api/sessions" });
    } finally {
      await pair.close();
    }
  }, 45_000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
