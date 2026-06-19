import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

export function signalServiceName(): string {
  return "CodeRelay Signal";
}

export interface SignalPeer {
  send(message: SignalOutboundMessage): void;
}

export type SignalOutboundMessage = Record<string, unknown>;

export interface SignalSession {
  readonly sessionId: string;
  receive(message: unknown): void;
  close(): void;
}

export interface SignalHubOptions {
  readonly now?: () => number;
  readonly iceServers?: readonly SignalIceServer[];
}

export interface SignalIceServer {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
}

export interface StartSignalServerOptions extends SignalHubOptions {
  readonly port?: number;
  readonly host?: string;
  readonly path?: string;
  readonly server?: HttpServer;
  readonly hub?: SignalHub;
}

export interface StartedSignalServer {
  readonly url: string;
  readonly hub: SignalHub;
  close(): Promise<void>;
}

interface HostRegistration {
  readonly hostId: string;
  readonly session: SignalSessionImpl;
}

interface PairingRegistration {
  readonly hostId: string;
  readonly pairingId: string;
  readonly expiresAt: string;
}

interface PendingConnectionRequest {
  readonly requestId: string;
  readonly hostId: string;
  readonly clientId: string;
  readonly hostSession: SignalSessionImpl;
  readonly clientSession: SignalSessionImpl;
}

interface PendingPairingRequest {
  readonly requestId: string;
  readonly hostId: string;
  readonly clientId: string;
  readonly hostSession: SignalSessionImpl;
  readonly clientSession: SignalSessionImpl;
}

interface AcceptedConnection {
  readonly connectionId: string;
  readonly hostId: string;
  readonly clientId: string;
  readonly hostSession: SignalSessionImpl;
  readonly clientSession: SignalSessionImpl;
}

export class SignalHub {
  private readonly now: () => number;
  private readonly iceServers: readonly SignalIceServer[];
  private nextSessionIndex = 0;
  private readonly hosts = new Map<string, HostRegistration>();
  private readonly pairings = new Map<string, PairingRegistration>();
  private readonly pendingPairings = new Map<string, PendingPairingRequest>();
  private readonly pendingConnections = new Map<string, PendingConnectionRequest>();
  private readonly acceptedConnections = new Map<string, AcceptedConnection>();

  constructor(options: SignalHubOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.iceServers = options.iceServers ?? [];
  }

  connectPeer(peer: SignalPeer): SignalSession {
    this.nextSessionIndex += 1;
    return new SignalSessionImpl(`signal-session-${this.nextSessionIndex}`, peer, this);
  }

  isHostOnline(hostId: string): boolean {
    return this.hosts.has(hostId);
  }

  handleMessage(session: SignalSessionImpl, message: unknown): void {
    if (!isObjectMessage(message)) {
      this.sendError(session, undefined, "invalid_message");
      return;
    }

    switch (message.type) {
      case "host.online":
        this.handleHostOnline(session, message);
        break;
      case "turn.get":
        this.handleTurnGet(session, message);
        break;
      case "pairing.open":
        this.handlePairingOpen(session, message);
        break;
      case "pairing.request":
        this.handlePairingRequest(session, message);
        break;
      case "pairing.accept":
        this.handlePairingAccept(session, message);
        break;
      case "pairing.reject":
        this.handlePairingReject(session, message);
        break;
      case "client.connect":
        this.handleClientConnect(session, message);
        break;
      case "connection.challenge":
        this.handleConnectionChallenge(session, message);
        break;
      case "connection.challenge_response":
        this.handleConnectionChallengeResponse(session, message);
        break;
      case "connection.accept":
        this.handleConnectionAccept(session, message);
        break;
      case "webrtc.offer":
      case "webrtc.answer":
      case "webrtc.candidate":
        this.handleWebRtcMessage(session, message);
        break;
      default:
        this.sendError(session, stringField(message, "requestId"), "unsupported_message");
        break;
    }
  }

  closeSession(session: SignalSessionImpl): void {
    for (const [hostId, registration] of this.hosts) {
      if (registration.session === session) {
        this.hosts.delete(hostId);
        for (const [pairingId, pairing] of this.pairings) {
          if (pairing.hostId === hostId) {
            this.pairings.delete(pairingId);
          }
        }
      }
    }

    for (const [requestId, request] of this.pendingConnections) {
      if (request.hostSession === session || request.clientSession === session) {
        this.pendingConnections.delete(requestId);
      }
    }

    for (const [requestId, request] of this.pendingPairings) {
      if (request.hostSession === session || request.clientSession === session) {
        this.pendingPairings.delete(requestId);
      }
    }

    for (const [connectionId, connection] of this.acceptedConnections) {
      if (connection.hostSession === session || connection.clientSession === session) {
        this.acceptedConnections.delete(connectionId);
      }
    }
  }

  private handleHostOnline(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const hostId = stringField(message, "hostId");
    if (!hostId) {
      this.sendError(session, stringField(message, "requestId"), "invalid_message");
      return;
    }

    this.removeHostRegistrationsForSession(session);
    this.hosts.set(hostId, { hostId, session });
  }

  private handleTurnGet(session: SignalSessionImpl, message: SignalInboundMessage): void {
    session.send({
      type: "turn.config",
      requestId: stringField(message, "requestId"),
      iceServers: this.iceServers,
    });
  }

  private handlePairingOpen(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const hostId = stringField(message, "hostId");
    const pairingId = stringField(message, "pairingId");
    const expiresAt = stringField(message, "expiresAt");
    if (!hostId || !pairingId || !expiresAt) {
      this.sendError(session, stringField(message, "requestId"), "invalid_message");
      return;
    }

    if (this.hosts.get(hostId)?.session !== session) {
      this.sendError(session, stringField(message, "requestId"), "host_offline");
      return;
    }

    this.pairings.set(pairingId, { hostId, pairingId, expiresAt });
  }

  private handlePairingRequest(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const pairingId = stringField(message, "pairingId");
    const clientId = stringField(message, "clientId");
    if (!requestId || !pairingId || !clientId) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pairing = this.pairings.get(pairingId);
    if (!pairing) {
      this.sendError(session, requestId, "pairing_not_found");
      return;
    }

    if (this.now() > Date.parse(pairing.expiresAt)) {
      this.pairings.delete(pairingId);
      this.sendError(session, requestId, "pairing_expired");
      return;
    }

    const host = this.hosts.get(pairing.hostId);
    if (!host) {
      this.sendError(session, requestId, "host_offline");
      return;
    }

    this.pendingPairings.set(requestId, {
      requestId,
      hostId: pairing.hostId,
      clientId,
      hostSession: host.session,
      clientSession: session,
    });
    host.session.send({
      ...message,
      type: "pairing.request",
      hostId: pairing.hostId,
      pairingId: pairing.pairingId,
    });
  }

  private handlePairingAccept(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const clientId = stringField(message, "clientId");
    if (!requestId || !hostId || !clientId) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pending = this.pendingPairings.get(requestId);
    if (!pending || pending.hostSession !== session || pending.hostId !== hostId || pending.clientId !== clientId) {
      this.sendError(session, requestId, "pairing_not_found");
      return;
    }

    this.pendingPairings.delete(requestId);
    pending.clientSession.send({
      type: "pairing.accepted",
      requestId,
      hostId,
      clientId,
    });
  }

  private handlePairingReject(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const reason = stringField(message, "reason") ?? "pairing_rejected";
    if (!requestId) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pending = this.pendingPairings.get(requestId);
    if (!pending || pending.hostSession !== session) {
      this.sendError(session, requestId, "pairing_not_found");
      return;
    }

    this.pendingPairings.delete(requestId);
    pending.clientSession.send({
      type: "pairing.rejected",
      requestId,
      hostId: pending.hostId,
      clientId: pending.clientId,
      reason,
    });
  }

  private handleClientConnect(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const clientId = stringField(message, "clientId");
    const clientPublicKeyFingerprint = stringField(message, "clientPublicKeyFingerprint");
    if (!requestId || !hostId || !clientId) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const host = this.hosts.get(hostId);
    if (!host) {
      this.sendError(session, requestId, "host_offline");
      return;
    }

    this.pendingConnections.set(requestId, {
      requestId,
      hostId,
      clientId,
      hostSession: host.session,
      clientSession: session,
    });
    const outbound: SignalOutboundMessage = {
      type: "client.connect",
      requestId,
      hostId,
      clientId,
      clientPublicKeyFingerprint,
    };
    copyIfPresent(message, outbound, "clientPublicKeyJwk");
    host.session.send(outbound);
  }

  private handleConnectionAccept(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const connectionId = stringField(message, "connectionId");
    const clientId = stringField(message, "clientId");
    if (!requestId || !connectionId || !clientId) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pending = this.pendingConnections.get(requestId);
    if (!pending || pending.hostSession !== session || pending.clientId !== clientId) {
      this.sendError(session, requestId, "connection_not_found");
      return;
    }

    this.pendingConnections.delete(requestId);
    this.acceptedConnections.set(connectionId, {
      connectionId,
      hostId: pending.hostId,
      clientId: pending.clientId,
      hostSession: pending.hostSession,
      clientSession: pending.clientSession,
    });
    pending.clientSession.send({
      type: "connection.accepted",
      requestId,
      connectionId,
      hostId: pending.hostId,
      clientId: pending.clientId,
    });
  }

  private handleConnectionChallenge(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const clientId = stringField(message, "clientId");
    const challenge = message.challenge;
    if (!requestId || !hostId || !clientId || !challenge) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pending = this.pendingConnections.get(requestId);
    if (!pending || pending.hostSession !== session || pending.hostId !== hostId || pending.clientId !== clientId) {
      this.sendError(session, requestId, "connection_not_found");
      return;
    }

    pending.clientSession.send({
      type: "connection.challenge",
      requestId,
      hostId,
      clientId,
      challenge,
    });
  }

  private handleConnectionChallengeResponse(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const clientId = stringField(message, "clientId");
    const proof = message.proof;
    if (!requestId || !hostId || !clientId || !proof) {
      this.sendError(session, requestId, "invalid_message");
      return;
    }

    const pending = this.pendingConnections.get(requestId);
    if (!pending || pending.clientSession !== session || pending.hostId !== hostId || pending.clientId !== clientId) {
      this.sendError(session, requestId, "connection_not_found");
      return;
    }

    pending.hostSession.send({
      type: "connection.challenge_response",
      requestId,
      hostId,
      clientId,
      proof,
    });
  }

  private handleWebRtcMessage(session: SignalSessionImpl, message: SignalInboundMessage): void {
    const connectionId = stringField(message, "connectionId");
    if (!connectionId) {
      this.sendError(session, stringField(message, "requestId"), "invalid_message");
      return;
    }

    const connection = this.acceptedConnections.get(connectionId);
    if (!connection) {
      this.sendError(session, stringField(message, "requestId"), "connection_not_found");
      return;
    }

    const from = connection.hostSession === session ? "host" : connection.clientSession === session ? "client" : null;
    if (!from) {
      this.sendError(session, stringField(message, "requestId"), "not_connection_participant");
      return;
    }

    const target = from === "host" ? connection.clientSession : connection.hostSession;
    const outbound: SignalOutboundMessage = {
      type: message.type,
      connectionId,
      from,
    };
    copyIfPresent(message, outbound, "sdp");
    copyIfPresent(message, outbound, "candidate");
    target.send(outbound);
  }

  private removeHostRegistrationsForSession(session: SignalSessionImpl): void {
    for (const [hostId, registration] of this.hosts) {
      if (registration.session === session) {
        this.hosts.delete(hostId);
      }
    }
  }

  private sendError(session: SignalSessionImpl, requestId: string | undefined, reason: string): void {
    const error: SignalOutboundMessage = {
      type: "signal.error",
      reason,
    };
    if (requestId) {
      error.requestId = requestId;
    }
    session.send(error);
  }
}

class SignalSessionImpl implements SignalSession {
  private closed = false;

  constructor(
    readonly sessionId: string,
    private readonly peer: SignalPeer,
    private readonly hub: SignalHub,
  ) {}

  receive(message: unknown): void {
    if (this.closed) {
      return;
    }
    this.hub.handleMessage(this, message);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.hub.closeSession(this);
  }

  send(message: SignalOutboundMessage): void {
    if (!this.closed) {
      this.peer.send(message);
    }
  }
}

type SignalInboundMessage = Record<string, unknown> & { readonly type?: string };

export function createSignalHub(options: SignalHubOptions = {}): SignalHub {
  return new SignalHub(options);
}

export async function startSignalServer(options: StartSignalServerOptions = {}): Promise<StartedSignalServer> {
  const path = options.path ?? "/";
  const hub = options.hub ?? createSignalHub(options);
  const httpServer = options.server ?? createServer();
  httpServer.on("request", (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "coderelay-signal" }));
      return;
    }

    if (!res.headersSent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    }
  });
  const webSocketServer = new WebSocketServer({ server: httpServer, path });

  webSocketServer.on("connection", (socket) => {
    const session = hub.connectPeer({
      send(message) {
        sendJson(socket, message);
      },
    });

    socket.on("message", (data) => {
      try {
        session.receive(JSON.parse(data.toString()));
      } catch {
        sendJson(socket, { type: "signal.error", reason: "invalid_json" });
      }
    });
    socket.on("close", () => {
      session.close();
    });
  });

  if (!options.server) {
    await listen(httpServer, options.port ?? 8787, options.host);
  }

  return {
    url: webSocketUrl(httpServer, path),
    hub,
    async close() {
      for (const client of webSocketServer.clients) {
        client.close();
      }
      await closeWebSocketServer(webSocketServer);
      if (!options.server) {
        await closeHttpServer(httpServer);
      }
    },
  };
}

function isObjectMessage(message: unknown): message is SignalInboundMessage {
  return typeof message === "object" && message !== null && typeof (message as { type?: unknown }).type === "string";
}

function stringField(message: SignalInboundMessage, key: string): string | undefined {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function copyIfPresent(source: SignalInboundMessage, target: SignalOutboundMessage, key: string): void {
  if (source[key] !== undefined) {
    target[key] = source[key];
  }
}

function sendJson(socket: WebSocket, message: SignalOutboundMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function listen(server: HttpServer, port: number, host: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
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

function closeHttpServer(server: HttpServer): Promise<void> {
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

function webSocketUrl(server: HttpServer, path: string): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Signal server is not listening on a TCP port");
  }

  return `ws://${hostForUrl(address)}:${address.port}${path}`;
}

function hostForUrl(address: AddressInfo): string {
  if (address.address === "::" || address.address === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (address.family === "IPv6") {
    return `[${address.address}]`;
  }

  return address.address;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  startSignalServer({ port }).then((server) => {
    console.log(`${signalServiceName()} listening on ${server.url}`);
  });
}
