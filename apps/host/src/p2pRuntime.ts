import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import WebSocket from "ws";
import { RTCPeerConnection, type PeerConfig, type RTCIceServer } from "werift";
import {
  createP2PBridge,
  type P2PBridge,
  type P2PBridgeHandlers,
  type P2PMessagePort,
} from "@coderelay/transport";
import {
  authorizeClientChallenge,
  acceptPairingProof,
  createChallenge,
  createPairingOffer,
  createTrustedDeviceStore,
  isTrustedClient,
  revokeClient,
  type Challenge,
  type ChallengeProof,
  type DeviceIdentity,
  type PairingProof,
  type PublicDeviceDescriptor,
  type TrustedDeviceStore,
} from "@coderelay/p2p-core";
import { createLocalHttpP2PBridgeHandlers } from "./p2pHttpBridge.js";
import type {
  HostPairingOffer,
  HostP2PRuntimeApi,
  P2PManagementState,
  P2PPairingResult,
  P2PPeerStatus,
  P2PSettings,
  P2PSignalStatus,
  P2PStatus,
} from "./p2pRoutes.js";

export interface HostP2PRuntimeOptions {
  readonly signalUrl: string;
  readonly hostId: string;
  readonly webUrl: string;
  readonly localApiBaseUrl: string;
  readonly authToken: string;
  readonly pairingTtlMs?: number;
  readonly iceServers?: readonly RTCIceServer[];
  readonly iceLocalAddresses?: readonly string[];
  readonly hostIdentity?: DeviceIdentity | PublicDeviceDescriptor;
  readonly trustedDeviceStore?: TrustedDeviceStore;
  readonly onTrustedDeviceStoreChanged?: (store: TrustedDeviceStore) => void | Promise<void>;
  readonly now?: () => number;
  readonly createPairingId?: () => string;
  readonly createPairingSecret?: () => string;
  readonly createPairingCode?: () => string;
  readonly createConnectionId?: () => string;
  readonly createSignalSocket?: (url: string) => SignalSocket;
  readonly createPeerConnection?: () => HostPeerConnection;
  readonly createBridge?: (port: P2PMessagePort, handlers: P2PBridgeHandlers) => P2PBridge;
  readonly signalReconnectDelayMs?: number;
  readonly onDiagnostic?: (event: HostP2PDiagnosticEvent) => void;
}

export type HostP2PDiagnosticEvent = Readonly<Record<string, unknown> & {
  readonly event: string;
  readonly timestamp: string;
}>;

export interface SignalSocket {
  readonly readyState: number;
  on(event: "open" | "message" | "close" | "error", listener: (data?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface HostPeerConnection {
  onicecandidate?: (event: { candidate?: unknown }) => void;
  ondatachannel?: (event: { channel: HostDataChannel }) => void;
  readonly localDescription?: { readonly sdp?: string };
  setRemoteDescription(description: { readonly type: "offer"; readonly sdp: string }): Promise<void>;
  createAnswer(): Promise<{ readonly type: "answer"; readonly sdp: string }>;
  setLocalDescription(description: { readonly type: "answer"; readonly sdp: string }): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): Promise<void>;
}

export interface HostDataChannel {
  readonly readyState: string;
  onmessage?: (event: { data: unknown }) => void;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  send(message: string): void;
  close(): void;
}

type SignalInboundMessage = Record<string, unknown> & { readonly type?: string };

const DEFAULT_PAIRING_TTL_MS = 2 * 60 * 1000;
const SIGNAL_OPEN = 1;

interface ActivePeer {
  readonly connectionId: string;
  readonly clientId: string;
  readonly peer: HostPeerConnection;
  activeChannel?: HostDataChannel;
  bridge?: P2PBridge;
  remoteDescriptionSet: boolean;
  readonly pendingCandidates: unknown[];
  status: P2PPeerStatus;
}

export class HostP2PRuntime implements HostP2PRuntimeApi {
  private socket?: SignalSocket;
  private signalStatus: P2PSignalStatus = "disconnected";
  private peerStatus: P2PPeerStatus = "disconnected";
  private activePairing?: P2PPairingResult;
  private trustedDeviceStore: TrustedDeviceStore;
  private readonly activePeers = new Map<string, ActivePeer>();
  private readonly pendingConnectionChallenges = new Map<
    string,
    { readonly clientId: string; readonly clientPublicKeyJwk: JsonWebKey; readonly challenge: Challenge }
  >();
  private readonly now: () => number;
  private readonly createPairingId: () => string;
  private readonly createPairingSecret: () => string;
  private readonly createPairingCode: () => string;
  private readonly createConnectionId: () => string;
  private readonly createSignalSocket: (url: string) => SignalSocket;
  private readonly createPeerConnection: () => HostPeerConnection;
  private readonly createBridge: (port: P2PMessagePort, handlers: P2PBridgeHandlers) => P2PBridge;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private publicWebUrl: string;
  private publicSignalUrl: string;
  private runtimeIceServers: readonly RTCIceServer[];

  constructor(private readonly options: HostP2PRuntimeOptions) {
    this.trustedDeviceStore = options.trustedDeviceStore ?? createTrustedDeviceStore();
    this.publicWebUrl = options.webUrl;
    this.publicSignalUrl = options.signalUrl;
    this.runtimeIceServers = options.iceServers ?? [];
    this.now = options.now ?? (() => Date.now());
    this.createPairingId = options.createPairingId ?? (() => `pair-${randomUUID()}`);
    this.createPairingSecret = options.createPairingSecret ?? (() => randomBytes(16).toString("base64url"));
    this.createPairingCode = options.createPairingCode ?? (() => randomBytes(5).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase());
    this.createConnectionId = options.createConnectionId ?? (() => `conn-${randomUUID()}`);
    this.createSignalSocket = options.createSignalSocket ?? ((url) => new WebSocket(url) as SignalSocket);
    this.createPeerConnection = options.createPeerConnection ?? (() => this.createWeriftPeerConnection());
    this.createBridge =
      options.createBridge ??
      ((port, handlers) => createP2PBridge(port, handlers));
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.socket) {
      return;
    }

    this.signalStatus = "connecting";
    const socket = this.createSignalSocket(this.publicSignalUrl);
    this.socket = socket;
    socket.on("message", (data) => {
      void this.handleSignalMessage(data);
    });
    socket.on("close", () => this.handleSignalDisconnect(socket));
    socket.on("error", () => this.handleSignalDisconnect(socket));

    if (socket.readyState === SIGNAL_OPEN) {
      this.markSignalOpen();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => {
        this.markSignalOpen();
        resolve();
      });
      socket.on("error", () => reject(new Error("Failed to connect CodeRelay Signal")));
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    await Promise.all([...this.activePeers.keys()].map((connectionId) => this.closePeer(connectionId)));
    this.socket?.close();
    this.socket = undefined;
    this.signalStatus = "disconnected";
    this.peerStatus = "disconnected";
  }

  getStatus(): P2PStatus {
    const activePairing = this.hasActivePairing() ? this.activePairing : undefined;
    return {
      enabled: true,
      signalStatus: this.signalStatus,
      peerStatus: this.peerStatus,
      hostId: this.options.hostId,
      signalUrl: this.publicSignalUrl,
      activePairing: activePairing
        ? {
            pairCode: activePairing.pairCode,
            pairingId: activePairing.offer.pairingId,
            expiresAt: activePairing.offer.expiresAt,
            pairingUrl: activePairing.pairingUrl,
          }
        : undefined,
    };
  }

  getManagementState(): P2PManagementState {
    const activeConnections = this.activeConnectionSummaries();
    return {
      devices: this.trustedDeviceStore.trustedClients.map((client) => ({
        clientId: client.clientId,
        displayName: client.displayName,
        addedAt: client.addedAt,
        lastUsedAt: client.lastUsedAt,
        lastTransport: client.lastTransport,
        revokedAt: client.revokedAt,
      })),
      topology: {
        signalUrl: this.publicSignalUrl,
        hostId: this.options.hostId,
        signalStatus: this.signalStatus,
        peerStatus: this.peerStatus,
        iceLocalAddresses: [...(this.options.iceLocalAddresses ?? [])],
        turnConfigured: this.runtimeIceServers.some((server) =>
          urlsForIceServer(server).some((url) => /^turns?:/i.test(url))
        ),
        iceServers: this.runtimeIceServers.map((server) => ({
          urls: server.urls,
          hasUsername: Boolean(server.username),
          hasCredential: Boolean(server.credential),
        })),
        activeConnection: activeConnections[0],
        activeConnections,
      },
    };
  }

  async revokeDevice(clientId: string): Promise<{ readonly ok: boolean; readonly clientId: string }> {
    const exists = this.trustedDeviceStore.trustedClients.some((client) => client.clientId === clientId);
    if (!exists) {
      return { ok: false, clientId };
    }

    this.trustedDeviceStore = revokeClient(this.trustedDeviceStore, clientId, {
      revokedAt: new Date(this.now()).toISOString(),
    });
    await this.options.onTrustedDeviceStoreChanged?.(this.trustedDeviceStore);
    const connections = [...this.activePeers.values()].filter((active) => active.clientId === clientId);
    for (const active of connections) {
      this.sendDeviceRevoked(active);
      await this.closePeer(active.connectionId);
    }
    return { ok: true, clientId };
  }

  getSettings(): P2PSettings {
    return {
      webUrl: this.publicWebUrl,
      signalUrl: this.publicSignalUrl,
    };
  }

  updateSettings(settings: Partial<P2PSettings>): P2PSettings {
    const nextWebUrl = settings.webUrl?.trim();
    const nextSignalUrl = settings.signalUrl?.trim();
    if (nextWebUrl) {
      this.publicWebUrl = nextWebUrl;
    }
    if (nextSignalUrl && nextSignalUrl !== this.publicSignalUrl) {
      this.publicSignalUrl = nextSignalUrl;
      this.socket?.close();
    }
    return this.getSettings();
  }

  openPairing(options: { readonly webUrl?: string }): P2PPairingResult {
    const webUrl = options.webUrl ?? this.publicWebUrl;
    const pairCode = this.createPairingCode();
    const offer = createPairingOffer({
      webUrl,
      signalUrl: this.publicSignalUrl,
      host: this.hostDescriptor(),
      pairingId: this.createPairingId(),
      pairingSecret: this.createPairingSecret(),
      now: this.now(),
      ttlMs: this.options.pairingTtlMs ?? DEFAULT_PAIRING_TTL_MS,
    }) satisfies HostPairingOffer;
    const pairingUrl = pairingUrlFor(webUrl, pairCode, this.publicSignalUrl, offer.pairingId);
    const result = { pairCode, offer, pairingUrl };
    this.activePairing = result;
    this.sendSignal({
      type: "pairing.open",
      hostId: this.options.hostId,
      pairCode,
      pairingId: offer.pairingId,
      offer,
      expiresAt: offer.expiresAt,
    });
    return result;
  }

  private createWeriftPeerConnection(): HostPeerConnection {
    const config: Partial<PeerConfig> = {
        iceServers: [...this.runtimeIceServers],
      iceTransportPolicy: "all",
      iceAdditionalHostAddresses: [...(this.options.iceLocalAddresses ?? [])],
      iceUseIpv4: true,
      iceUseIpv6: false,
    } as Partial<PeerConfig>;
    return new RTCPeerConnection(config) as unknown as HostPeerConnection;
  }

  private markSignalOpen(): void {
    this.signalStatus = "connected";
    this.sendSignal({ type: "host.online", hostId: this.options.hostId });
    this.sendSignal({ type: "turn.get", requestId: `host-turn-${randomUUID()}` });
    this.publishActivePairing();
  }

  private handleSignalDisconnect(socket: SignalSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.socket = undefined;
    this.signalStatus = "disconnected";
    this.scheduleSignalReconnect();
  }

  private scheduleSignalReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start().catch(() => this.scheduleSignalReconnect());
    }, this.options.signalReconnectDelayMs ?? 1000);
  }

  private publishActivePairing(): void {
    if (!this.hasActivePairing() || !this.activePairing) {
      return;
    }

    this.sendSignal({
      type: "pairing.open",
      hostId: this.options.hostId,
      pairCode: this.activePairing.pairCode,
      pairingId: this.activePairing.offer.pairingId,
      offer: this.activePairing.offer,
      expiresAt: this.activePairing.offer.expiresAt,
    });
  }

  private async handleSignalMessage(data: unknown): Promise<void> {
    const message = parseSignalMessage(data);
    if (!message) {
      return;
    }

    if (message.type === "client.connect") {
      this.handleClientConnect(message);
      return;
    }

    if (message.type === "turn.config") {
      this.handleTurnConfig(message);
      return;
    }

    if (message.type === "pairing.request") {
      await this.handlePairingRequest(message);
      return;
    }

    if (message.type === "connection.challenge_response") {
      await this.handleConnectionChallengeResponse(message);
      return;
    }

    if (message.type === "webrtc.offer") {
      await this.handleOffer(message);
      return;
    }

    if (message.type === "webrtc.candidate") {
      await this.handleCandidate(message);
    }
  }

  private handleClientConnect(message: SignalInboundMessage): void {
    const requestId = stringField(message, "requestId");
    const clientId = stringField(message, "clientId");
    const hostId = stringField(message, "hostId");
    const clientPublicKeyJwk = jsonWebKeyField(message, "clientPublicKeyJwk");
    if (!requestId || !clientId || hostId !== this.options.hostId) {
      return;
    }
    if (!clientPublicKeyJwk || !isTrustedClient(this.trustedDeviceStore, clientId, clientPublicKeyJwk)) {
      this.rejectConnection(requestId, clientId, "untrusted_client");
      return;
    }

    const challenge = createChallenge();
    this.pendingConnectionChallenges.set(requestId, {
      clientId,
      clientPublicKeyJwk,
      challenge,
    });
    this.sendSignal({
      type: "connection.challenge",
      requestId,
      hostId: this.options.hostId,
      clientId,
      challenge,
    });
  }

  private async handleConnectionChallengeResponse(message: SignalInboundMessage): Promise<void> {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const clientId = stringField(message, "clientId");
    const proof = challengeProofField(message, "proof");
    if (!requestId || hostId !== this.options.hostId || !clientId || !proof) {
      return;
    }

    const pending = this.pendingConnectionChallenges.get(requestId);
    if (
      !pending ||
      pending.clientId !== clientId ||
      proof.deviceId !== clientId ||
      proof.challengeId !== pending.challenge.challengeId
    ) {
      return;
    }

    this.pendingConnectionChallenges.delete(requestId);
    const authorized = await authorizeClientChallenge(this.trustedDeviceStore, {
      clientId,
      clientPublicKeyJwk: pending.clientPublicKeyJwk,
      challenge: pending.challenge,
      signature: proof.signature,
    });
    if (!authorized.ok) {
      return;
    }

    this.acceptConnection(requestId, clientId);
  }

  private acceptConnection(requestId: string, clientId: string): void {
    const connectionId = this.createConnectionId();
    this.emitDiagnostic("p2p.connection.accepted", {
      requestId,
      connectionId,
      clientId,
    });
    void this.markClientUsed(clientId, "p2p");
    const peer = this.createPeerConnection();
    const active: ActivePeer = {
      connectionId,
      clientId,
      peer,
      remoteDescriptionSet: false,
      pendingCandidates: [],
      status: "connecting",
    };
    this.activePeers.set(connectionId, active);
    this.updatePeerStatus();
    peer.onicecandidate = (event) => {
      if (event.candidate && this.activePeers.get(connectionId) === active) {
        this.emitDiagnostic("p2p.webrtc.local-candidate", {
          connectionId,
          clientId,
          candidateType: candidateType(event.candidate),
        });
        this.sendSignal({
          type: "webrtc.candidate",
          connectionId,
          candidate: event.candidate,
        });
      }
    };
    peer.ondatachannel = (event) => {
      this.attachDataChannel(active, event.channel);
    };

    this.sendSignal({
      type: "connection.accept",
      requestId,
      connectionId,
      clientId,
    });
  }

  private async handlePairingRequest(message: SignalInboundMessage): Promise<void> {
    const requestId = stringField(message, "requestId");
    const hostId = stringField(message, "hostId");
    const pairingId = stringField(message, "pairingId");
    const clientId = stringField(message, "clientId");
    const displayName = stringField(message, "displayName") ?? clientId;
    const proof = pairingProofField(message, "proof");
    if (!requestId || hostId !== this.options.hostId || !pairingId || !clientId || !proof) {
      this.rejectPairing(requestId, "invalid_pairing");
      return;
    }

    if (!this.activePairing || this.activePairing.offer.pairingId !== pairingId) {
      this.rejectPairing(requestId, "pairing_not_found");
      return;
    }

    const accepted = await acceptPairingProof(this.trustedDeviceStore, this.activePairing.offer, proof, {
      now: this.now(),
      displayName,
    });
    if (!accepted.ok) {
      this.rejectPairing(requestId, accepted.reason);
      return;
    }

    this.trustedDeviceStore = accepted.store;
    await this.options.onTrustedDeviceStoreChanged?.(this.trustedDeviceStore);
    this.activePairing = undefined;
    this.sendSignal({
      type: "pairing.accept",
      requestId,
      hostId: this.options.hostId,
      clientId,
    });
  }

  private async handleOffer(message: SignalInboundMessage): Promise<void> {
    const sdp = stringField(message, "sdp");
    const connectionId = stringField(message, "connectionId");
    const active = connectionId ? this.activePeers.get(connectionId) : undefined;
    if (!sdp || !connectionId || !active) {
      return;
    }

    this.emitDiagnostic("p2p.webrtc.offer.received", {
      connectionId,
      clientId: active.clientId,
      sdpBytes: Buffer.byteLength(sdp, "utf8"),
      queuedRemoteCandidates: active.pendingCandidates.length,
    });
    await active.peer.setRemoteDescription({ type: "offer", sdp });
    active.remoteDescriptionSet = true;
    await this.flushPendingCandidates(active);
    const answer = await active.peer.createAnswer();
    await active.peer.setLocalDescription(answer);
    const answerSdp = active.peer.localDescription?.sdp ?? answer.sdp;
    this.emitDiagnostic("p2p.webrtc.answer.sent", {
      connectionId,
      clientId: active.clientId,
      sdpBytes: Buffer.byteLength(answerSdp, "utf8"),
    });
    this.sendSignal({
      type: "webrtc.answer",
      connectionId,
      sdp: answerSdp,
    });
  }

  private async handleCandidate(message: SignalInboundMessage): Promise<void> {
    const connectionId = stringField(message, "connectionId");
    const active = connectionId ? this.activePeers.get(connectionId) : undefined;
    if (!connectionId || !active) {
      return;
    }
    const candidate = message.candidate;
    if (!candidate) {
      return;
    }

    this.emitDiagnostic("p2p.webrtc.remote-candidate", {
      connectionId,
      clientId: active.clientId,
      candidateType: candidateType(candidate),
      remoteDescriptionSet: active.remoteDescriptionSet,
    });
    if (!active.remoteDescriptionSet) {
      active.pendingCandidates.push(candidate);
      return;
    }

    await active.peer.addIceCandidate(candidate);
  }

  private handleTurnConfig(message: SignalInboundMessage): void {
    const iceServers = iceServersField(message, "iceServers");
    if (!iceServers) {
      return;
    }
    this.runtimeIceServers = iceServers;
    this.emitDiagnostic("p2p.ice.config", {
      iceServerCount: iceServers.length,
      turnConfigured: iceServers.some((server) => urlsForIceServer(server).some((url) => /^turns?:/i.test(url))),
      stunConfigured: iceServers.some((server) => urlsForIceServer(server).some((url) => /^stun:/i.test(url))),
    });
  }

  private async flushPendingCandidates(active: ActivePeer): Promise<void> {
    while (active.pendingCandidates.length > 0) {
      await active.peer.addIceCandidate(active.pendingCandidates.shift());
    }
  }

  private attachDataChannel(active: ActivePeer, channel: HostDataChannel): void {
    active.activeChannel = channel;
    const setConnected = () => {
      active.status = "connected";
      this.updatePeerStatus();
      this.emitDiagnostic("p2p.datachannel.open", {
        connectionId: active.connectionId,
        clientId: active.clientId,
        readyState: channel.readyState,
      });
      active.bridge?.close();
      active.bridge = this.createBridge(
        dataChannelPort(channel, () => this.handlePeerDisconnected(active.connectionId)),
        createLocalHttpP2PBridgeHandlers({
          baseUrl: this.options.localApiBaseUrl,
          authToken: this.options.authToken,
        })
      );
    };

    channel.onclose = () => {
      this.handlePeerDisconnected(active.connectionId);
    };
    channel.onerror = () => {
      this.handlePeerDisconnected(active.connectionId);
    };

    if (channel.readyState === "open") {
      setConnected();
      return;
    }

    channel.onopen = setConnected;
  }

  private hasActivePairing(): boolean {
    if (!this.activePairing) {
      return false;
    }

    if (this.now() > Date.parse(this.activePairing.offer.expiresAt)) {
      this.activePairing = undefined;
      return false;
    }

    return true;
  }

  private rejectPairing(requestId: string | undefined, reason: string): void {
    if (!requestId) {
      return;
    }

    this.sendSignal({
      type: "pairing.reject",
      requestId,
      reason,
    });
  }

  private rejectConnection(requestId: string, clientId: string, reason: string): void {
    this.sendSignal({
      type: "connection.reject",
      requestId,
      hostId: this.options.hostId,
      clientId,
      reason,
    });
  }

  private hostDescriptor(): PublicDeviceDescriptor {
    return (
      this.options.hostIdentity ?? {
        deviceId: this.options.hostId,
        publicKeyJwk: fallbackHostPublicKeyJwk(this.options.hostId),
        publicKeyFingerprint: createHostFingerprint(this.options.hostId),
      }
    );
  }

  private async closePeer(connectionId: string): Promise<void> {
    const active = this.activePeers.get(connectionId);
    if (!active) {
      return;
    }

    active.bridge?.close();
    active.bridge = undefined;
    active.activeChannel = undefined;
    this.activePeers.delete(connectionId);
    this.updatePeerStatus();
    await active.peer.close();
  }

  private sendSignal(message: Record<string, unknown>): void {
    if (this.socket?.readyState === SIGNAL_OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private sendDeviceRevoked(active: ActivePeer): void {
    active.activeChannel?.send(JSON.stringify({
      type: "event",
      event: {
        type: "device_revoked",
        message: "此设备授权已被 Host 撤销，请在电脑端重新扫码或获取新的授权链接。",
      },
    }));
  }

  private async markClientUsed(clientId: string, transport: "p2p" | "http"): Promise<void> {
    let changed = false;
    const usedAt = new Date(this.now()).toISOString();
    const trustedClients = this.trustedDeviceStore.trustedClients.map((client) => {
      if (client.clientId !== clientId || client.revokedAt) {
        return client;
      }
      changed = true;
      return {
        ...client,
        lastUsedAt: usedAt,
        lastTransport: transport,
      };
    });
    if (!changed) {
      return;
    }

    this.trustedDeviceStore = {
      ...this.trustedDeviceStore,
      trustedClients,
    };
    await this.options.onTrustedDeviceStoreChanged?.(this.trustedDeviceStore);
  }

  private emitDiagnostic(event: string, detail: Record<string, unknown> = {}): void {
    const diagnostic = {
      event,
      timestamp: new Date(this.now()).toISOString(),
      hostId: this.options.hostId,
      ...detail,
    } satisfies HostP2PDiagnosticEvent;
    this.options.onDiagnostic?.(diagnostic);
    console.log("[coderelay:p2p]", JSON.stringify(diagnostic));
  }

  private handlePeerDisconnected(connectionId: string): void {
    const active = this.activePeers.get(connectionId);
    if (!active) {
      return;
    }

    active.bridge?.close();
    active.bridge = undefined;
    active.activeChannel = undefined;
    this.activePeers.delete(connectionId);
    this.updatePeerStatus();
  }

  private updatePeerStatus(): void {
    const peers = [...this.activePeers.values()];
    if (peers.some((peer) => peer.status === "connected")) {
      this.peerStatus = "connected";
      return;
    }
    if (peers.some((peer) => peer.status === "connecting")) {
      this.peerStatus = "connecting";
      return;
    }
    this.peerStatus = "disconnected";
  }

  private activeConnectionSummaries(): Array<{
    readonly clientId: string;
    readonly connectionId: string;
    readonly transport: "p2p";
    readonly route: string;
  }> {
    return [...this.activePeers.values()].map((active) => ({
      clientId: active.clientId,
      connectionId: active.connectionId,
      transport: "p2p" as const,
      route: "WebRTC DataChannel -> Host local HTTP bridge",
    }));
  }
}

function dataChannelPort(channel: HostDataChannel, onDisconnect: () => void): P2PMessagePort {
  const listeners = new Set<(message: string) => void>();
  channel.onmessage = (event) => {
    const message = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
    for (const listener of listeners) {
      listener(message);
    }
  };
  channel.onclose = onDisconnect;
  channel.onerror = onDisconnect;

  return {
    send(message) {
      channel.send(message);
    },
    addMessageListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parseSignalMessage(data: unknown): SignalInboundMessage | null {
  try {
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const parsed = JSON.parse(raw) as SignalInboundMessage;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function stringField(message: SignalInboundMessage, key: string): string | undefined {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function jsonWebKeyField(message: SignalInboundMessage, key: string): JsonWebKey | undefined {
  const value = message[key];
  if (typeof value === "object" && value !== null) {
    return value as JsonWebKey;
  }

  return undefined;
}

function iceServersField(message: SignalInboundMessage, key: string): readonly RTCIceServer[] | undefined {
  const value = message[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const urls = (entry as { urls?: unknown }).urls;
    if (typeof urls !== "string" && !Array.isArray(urls)) {
      return [];
    }
    return [{
      urls: urls as RTCIceServer["urls"],
      username: typeof (entry as { username?: unknown }).username === "string"
        ? (entry as { username: string }).username
        : undefined,
      credential: typeof (entry as { credential?: unknown }).credential === "string"
        ? (entry as { credential: string }).credential
        : undefined,
    }];
  });
}

function pairingProofField(message: SignalInboundMessage, key: string): PairingProof | undefined {
  const value = message[key];
  if (typeof value === "object" && value !== null && (value as { protocol?: unknown }).protocol === "coderelay-pairing-proof-v1") {
    return value as PairingProof;
  }

  return undefined;
}

function challengeProofField(message: SignalInboundMessage, key: string): ChallengeProof | undefined {
  const value = message[key];
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === "coderelay-challenge-proof-v1" &&
    typeof (value as { signature?: unknown }).signature === "string"
  ) {
    return value as ChallengeProof;
  }

  return undefined;
}

function pairingUrlFor(webUrl: string, pairCode: string, signalUrl: string, cacheKey: string): string {
  const url = new URL(webUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/pair/${encodeURIComponent(pairCode)}`;
  url.search = new URLSearchParams({ v: cacheKey }).toString();
  url.hash = new URLSearchParams({ signal: signalUrl }).toString();
  return url.toString();
}

function createHostFingerprint(hostId: string): string {
  return createHash("sha256").update(`coderelay-host:${hostId}`).digest("base64url");
}

function candidateType(candidate: unknown): string {
  if (typeof candidate === "object" && candidate !== null) {
    const directType = (candidate as { type?: unknown }).type;
    if (typeof directType === "string" && directType) {
      return directType;
    }
    const raw = (candidate as { candidate?: unknown }).candidate;
    if (typeof raw === "string") {
      const match = raw.match(/\btyp\s+([a-z0-9-]+)/i);
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }
  }
  if (typeof candidate === "string") {
    const match = candidate.match(/\btyp\s+([a-z0-9-]+)/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  return "unknown";
}

function urlsForIceServer(server: RTCIceServer): readonly string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

function fallbackHostPublicKeyJwk(hostId: string): JsonWebKey {
  return {
    kty: "oct",
    k: createHostFingerprint(hostId),
    key_ops: [],
    ext: true,
  };
}
