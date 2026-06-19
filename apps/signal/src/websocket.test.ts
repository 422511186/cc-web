import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as signal from "./index.js";

const api = signal as Record<string, unknown>;

function expectApiFunction<T extends (...args: any[]) => any>(name: string): T {
  expect(typeof api[name]).toBe("function");
  return api[name] as T;
}

describe("Signal WebSocket server", () => {
  it("exposes an HTTP health check for process readiness", async () => {
    const startSignalServer = expectApiFunction("startSignalServer");
    const server = await startSignalServer({ port: 0 });

    try {
      const response = await fetch(server.url.replace(/^ws:/, "http:").replace(/\/$/, "/healthz"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, service: "coderelay-signal" });
    } finally {
      await server.close();
    }
  });

  it("routes connect, accept, and WebRTC offer messages over real WebSocket connections", async () => {
    const startSignalServer = expectApiFunction("startSignalServer");
    const server = await startSignalServer({ port: 0 });
    const host = await openWebSocket(server.url);
    const client = await openWebSocket(server.url);

    try {
      sendJson(host, { type: "host.online", hostId: "host-1" });
      sendJson(client, {
        type: "client.connect",
        requestId: "req-1",
        hostId: "host-1",
        clientId: "phone-1",
        clientPublicKeyFingerprint: "client-fp",
      });

      await expect(nextJson(host)).resolves.toEqual({
        type: "client.connect",
        requestId: "req-1",
        hostId: "host-1",
        clientId: "phone-1",
        clientPublicKeyFingerprint: "client-fp",
      });

      sendJson(host, {
        type: "connection.accept",
        requestId: "req-1",
        connectionId: "conn-1",
        clientId: "phone-1",
      });
      await expect(nextJson(client)).resolves.toEqual({
        type: "connection.accepted",
        requestId: "req-1",
        connectionId: "conn-1",
        hostId: "host-1",
        clientId: "phone-1",
      });

      sendJson(client, { type: "webrtc.offer", connectionId: "conn-1", sdp: "offer-sdp" });

      await expect(nextJson(host)).resolves.toEqual({
        type: "webrtc.offer",
        connectionId: "conn-1",
        from: "client",
        sdp: "offer-sdp",
      });
    } finally {
      host.close();
      client.close();
      await server.close();
    }
  });
});

function sendJson(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message));
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}
