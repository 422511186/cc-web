import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  P2PTransport,
  createP2PBridge,
  type P2PMessagePort,
  type TransportStream,
} from "@coderelay/transport";
import {
  createWeriftDataChannelPair,
  type DataChannelRpcPeer,
  type WeriftDataChannelPair,
} from "@coderelay/transport/webrtc-node";
import { createApp } from "../../host/dist/app.js";
import { createLocalHttpP2PBridgeHandlers } from "../../host/dist/p2pHttpBridge.js";
import { SessionStore } from "../../host/dist/store.js";
import { SSEManager } from "../../host/dist/sse.js";
import {
  assistantAnswer,
  authToken,
  hostUrl,
  imageCacheDir,
  projectId,
  projectName,
  projectsDir,
  sessionId,
  uploadsDir,
  userPrompt,
} from "./helpers/fixture";

test("P2PTransport 通过 WebRTC DataChannel 端到端访问 Host 业务 API 和 SSE", async () => {
  test.setTimeout(120_000);

  const store = new SessionStore(projectsDir);
  const sseManager = new SSEManager(store);
  const server = await startHostServer(store, sseManager);
  const pair = await createWeriftDataChannelPair();
  const ports = createRpcMessagePorts(pair);
  const bridge = createP2PBridge(
    ports.host,
    createLocalHttpP2PBridgeHandlers({
      baseUrl: `${server.baseUrl}/api`,
      authToken,
    }),
  );
  const transport = new P2PTransport({ port: ports.client });
  let stream: TransportStream | undefined;

  try {
    const projects = await transport.request<{ projects: Array<{ id: string; name: string }> }>({
      method: "GET",
      path: "/projects",
    });
    expect(projects.projects).toContainEqual(expect.objectContaining({ id: projectId, name: projectName }));

    const sessions = await transport.request<{ sessions: Array<{ id: string; title: string }> }>({
      method: "GET",
      path: `/projects/${projectId}/sessions`,
    });
    expect(sessions.sessions).toContainEqual(expect.objectContaining({ id: sessionId, title: userPrompt }));

    const detail = await transport.request<{
      session: { id: string; messages: Array<{ content: string }> };
    }>({
      method: "GET",
      path: `/sessions/${sessionId}?projectId=${encodeURIComponent(projectId)}`,
    });
    expect(detail.session.id).toBe(sessionId);
    expect(detail.session.messages.map((message) => message.content)).toContain(assistantAnswer);

    const streamEvents: unknown[] = [];
    let opened = false;
    stream = transport.subscribe({
      path: "/events",
      eventName: "session-update",
      onOpen: () => {
        opened = true;
      },
      onEvent: (event) => streamEvents.push(event),
    });

    await expect.poll(() => opened).toBe(true);
    sseManager.notifySessionUpdate(projectId, sessionId);
    await expect.poll(() => streamEvents.length).toBe(1);
    expect(streamEvents[0]).toEqual({ projectId, sessionId });
  } finally {
    stream?.close();
    bridge.close();
    await pair.close();
    sseManager.close();
    await closeServer(server.server);
  }
});

async function startHostServer(store: SessionStore, sseManager: SSEManager): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> {
  const app = createApp(
    {
      authToken,
      port: 0,
      claudeProjectsDir: projectsDir,
      imageCacheDir,
      permissionMode: "default",
      idleTimeoutMs: 30_000,
      heartbeatTtlMs: 30_000,
      orphanIdleTimeoutMs: 30_000,
      maxConcurrent: 3,
      uploadsDir,
    },
    store,
    sseManager,
    {
      async *start() {
        throw new Error("SDK should not be started by E2E browse/P2P bridge tests");
      },
    },
  );
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function createRpcMessagePorts(pair: WeriftDataChannelPair): {
  readonly client: P2PMessagePort;
  readonly host: P2PMessagePort;
} {
  const clientListeners = new Set<(message: string) => void>();
  const hostListeners = new Set<(message: string) => void>();

  pair.client.handleRequests(async ({ body }) => {
    dispatchMessage(clientListeners, body);
    return { ok: true };
  });
  pair.host.handleRequests(async ({ body }) => {
    dispatchMessage(hostListeners, body);
    return { ok: true };
  });

  return {
    client: portFor(pair.client, clientListeners),
    host: portFor(pair.host, hostListeners),
  };
}

function portFor(sender: DataChannelRpcPeer, listeners: Set<(message: string) => void>): P2PMessagePort {
  return {
    send(message) {
      void sender.request(message).catch(() => undefined);
    },
    addMessageListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function dispatchMessage(listeners: Set<(message: string) => void>, body: unknown): void {
  if (typeof body !== "string") {
    return;
  }

  for (const listener of listeners) {
    queueMicrotask(() => listener(body));
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
