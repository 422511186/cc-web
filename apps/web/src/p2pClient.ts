import { P2PTransport, type P2PMessagePort } from "@coderelay/transport";
import {
  createDeviceIdentity,
  createPairingProof,
  createTrustedDeviceStore,
  signChallenge,
  trustHost,
  verifyPairingOffer,
  type Challenge,
  type DeviceIdentity,
  type TrustedDeviceStore,
} from "@coderelay/p2p-core";

export interface BrowserPairingOffer {
  readonly protocol: "coderelay-pairing-v1";
  readonly webUrl: string;
  readonly signalUrl: string;
  readonly hostId: string;
  readonly hostPublicKeyJwk: JsonWebKey;
  readonly hostPublicKeyFingerprint: string;
  readonly pairingId: string;
  readonly pairingSecret: string;
  readonly expiresAt: string;
}

export interface BrowserP2PSession {
  readonly transport: P2PTransport;
  readonly connectionId: string;
  readonly clientId: string;
  close(): void;
}

export interface BrowserP2PConnectOptions {
  readonly createWebSocket?: (url: string) => WebSocket;
  readonly createPeerConnection?: () => RTCPeerConnection;
  readonly createClientId?: () => string;
  readonly createRequestId?: () => string;
  readonly loadClientIdentity?: () => Promise<DeviceIdentity>;
  readonly timeoutMs?: number;
}

type SignalMessage = Record<string, unknown> & { readonly type?: string };

const DATA_CHANNEL_LABEL = "coderelay";
const CLIENT_ID_STORAGE_KEY = "coderelay-client-id";
const CLIENT_IDENTITY_STORAGE_KEY = "coderelay-client-identity-v1";
const TRUSTED_DEVICE_STORE_KEY = "coderelay-trusted-device-store-v1";
const DEFAULT_TIMEOUT_MS = 20_000;

export function decodePairingOfferFromUrl(url: string): BrowserPairingOffer | null {
  const encoded = new URL(url, window.location.href).searchParams.get("p2p");
  if (!encoded) {
    return null;
  }

  try {
    const offer = JSON.parse(base64UrlDecode(encoded)) as BrowserPairingOffer;
    if (offer.protocol !== "coderelay-pairing-v1" || !offer.signalUrl || !offer.hostId || !offer.hostPublicKeyJwk) {
      return null;
    }
    return offer;
  } catch {
    return null;
  }
}

export function currentPairingOffer(): BrowserPairingOffer | null {
  return decodePairingOfferFromUrl(window.location.href);
}

export async function connectBrowserP2P(
  offer: BrowserPairingOffer,
  options: BrowserP2PConnectOptions = {},
): Promise<BrowserP2PSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const offerResult = verifyPairingOffer(offer);
  if (!offerResult.ok) {
    throw new Error(offerResult.reason === "expired" ? "配对链接已过期" : "配对链接无效");
  }

  const clientIdentity = await loadClientIdentity(options);
  const socket = await openSignalSocket(offer.signalUrl, options.createWebSocket, timeoutMs);
  const signal = new BrowserSignalClient(socket);
  const pairingRequestId = nextRequestId(options, "pair");
  const connectionRequestId = nextRequestId(options, "connect");
  const proof = await createPairingProof(offer, clientIdentity);

  signal.send({
    type: "pairing.request",
    requestId: pairingRequestId,
    hostId: offer.hostId,
    pairingId: offer.pairingId,
    clientId: clientIdentity.deviceId,
    clientPublicKeyJwk: clientIdentity.publicKeyJwk,
    clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    proof,
  });

  const pairingReply = await signal.waitFor(
    (message) =>
      (message.type === "pairing.accepted" || message.type === "pairing.rejected") &&
      message.requestId === pairingRequestId &&
      message.hostId === offer.hostId &&
      message.clientId === clientIdentity.deviceId,
    timeoutMs,
    "等待 Host 接受设备配对超时",
  );
  if (pairingReply.type === "pairing.rejected") {
    throw new Error(typeof pairingReply.reason === "string" ? pairingReply.reason : "设备配对被拒绝");
  }

  rememberTrustedHost(offer);

  signal.send({
    type: "client.connect",
    requestId: connectionRequestId,
    hostId: offer.hostId,
    clientId: clientIdentity.deviceId,
    clientPublicKeyJwk: clientIdentity.publicKeyJwk,
    clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
  });

  const challengeMessage = await signal.waitFor(
    (message) =>
      message.type === "connection.challenge" &&
      message.requestId === connectionRequestId &&
      message.hostId === offer.hostId &&
      message.clientId === clientIdentity.deviceId,
    timeoutMs,
    "等待 Host 连接挑战超时",
  );
  const challenge = challengeField(challengeMessage, "challenge");
  if (!challenge) {
    throw new Error("Signal challenge did not include a valid challenge");
  }
  signal.send({
    type: "connection.challenge_response",
    requestId: connectionRequestId,
    hostId: offer.hostId,
    clientId: clientIdentity.deviceId,
    proof: await signChallenge(clientIdentity, challenge),
  });

  const accepted = await signal.waitFor(
    (message) =>
      message.type === "connection.accepted" &&
      message.requestId === connectionRequestId &&
      message.hostId === offer.hostId &&
      message.clientId === clientIdentity.deviceId,
    timeoutMs,
    "等待 Host 接受 P2P 连接超时",
  );
  const connectionId = stringField(accepted, "connectionId");
  if (!connectionId) {
    throw new Error("Signal accepted connection without connectionId");
  }

  const peer = options.createPeerConnection?.() ?? new RTCPeerConnection();
  const pendingCandidates: unknown[] = [];
  let remoteDescriptionSet = false;
  const removeCandidateListener = signal.onMessage((message) => {
    if (message.type !== "webrtc.candidate" || message.connectionId !== connectionId || !message.candidate) {
      return;
    }
    if (!remoteDescriptionSet) {
      pendingCandidates.push(message.candidate);
      return;
    }
    void peer.addIceCandidate(message.candidate as RTCIceCandidateInit);
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      signal.send({
        type: "webrtc.candidate",
        connectionId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  const channel = peer.createDataChannel(DATA_CHANNEL_LABEL);
  const channelOpen = waitForDataChannelOpen(channel, timeoutMs);
  const answerPromise = signal.waitFor(
    (message) => message.type === "webrtc.answer" && message.connectionId === connectionId,
    timeoutMs,
    "等待 Host WebRTC answer 超时",
  );

  const localOffer = await peer.createOffer();
  await peer.setLocalDescription(localOffer);
  signal.send({
    type: "webrtc.offer",
    connectionId,
    sdp: peer.localDescription?.sdp ?? localOffer.sdp,
  });

  const answer = await answerPromise;
  const sdp = stringField(answer, "sdp");
  if (!sdp) {
    throw new Error("Signal answer did not include SDP");
  }
  await peer.setRemoteDescription({ type: "answer", sdp });
  remoteDescriptionSet = true;
  while (pendingCandidates.length > 0) {
    await peer.addIceCandidate(pendingCandidates.shift() as RTCIceCandidateInit);
  }
  await channelOpen;

  const transport = new P2PTransport({ port: dataChannelPort(channel) });
  return {
    transport,
    connectionId,
    clientId: clientIdentity.deviceId,
    close() {
      removeCandidateListener();
      channel.close();
      peer.close();
      socket.close();
    },
  };
}

class BrowserSignalClient {
  private readonly queued: SignalMessage[] = [];
  private readonly waiters = new Set<{
    readonly predicate: (message: SignalMessage) => boolean;
    readonly resolve: (message: SignalMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timeout: number;
  }>();
  private readonly listeners = new Set<(message: SignalMessage) => void>();

  constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = parseSignalMessage(event.data);
      if (!message) {
        return;
      }

      for (const listener of this.listeners) {
        listener(message);
      }

      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          window.clearTimeout(waiter.timeout);
          this.waiters.delete(waiter);
          waiter.resolve(message);
          return;
        }
      }
      this.queued.push(message);
    };
  }

  send(message: SignalMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: (message: SignalMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitFor(
    predicate: (message: SignalMessage) => boolean,
    timeoutMs: number,
    errorMessage: string,
  ): Promise<SignalMessage> {
    const index = this.queued.findIndex(predicate);
    if (index >= 0) {
      const [message] = this.queued.splice(index, 1);
      return Promise.resolve(message);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timeout: window.setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(errorMessage));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }
}

function dataChannelPort(channel: RTCDataChannel): P2PMessagePort {
  const listeners = new Set<(message: string) => void>();
  channel.onmessage = (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    for (const listener of listeners) {
      listener(event.data);
    }
  };

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

function openSignalSocket(
  signalUrl: string,
  factory: ((url: string) => WebSocket) | undefined,
  timeoutMs: number,
): Promise<WebSocket> {
  const socket = factory?.(signalUrl) ?? new WebSocket(signalUrl);
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(socket);
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("连接 CodeRelay Signal 超时")), timeoutMs);
    socket.onopen = () => {
      window.clearTimeout(timeout);
      resolve(socket);
    };
    socket.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("连接 CodeRelay Signal 失败"));
    };
  });
}

function waitForDataChannelOpen(channel: RTCDataChannel, timeoutMs: number): Promise<void> {
  if (channel.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("等待 P2P DataChannel 打开超时")), timeoutMs);
    channel.onopen = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    channel.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("P2P DataChannel 连接失败"));
    };
    channel.onclose = () => {
      window.clearTimeout(timeout);
      reject(new Error("P2P DataChannel 在打开前关闭"));
    };
  });
}

function parseSignalMessage(data: unknown): SignalMessage | null {
  try {
    const message = JSON.parse(String(data)) as SignalMessage;
    return typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}

function stringField(message: SignalMessage, key: string): string | undefined {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function challengeField(message: SignalMessage, key: string): Challenge | undefined {
  const value = message[key];
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === "coderelay-challenge-v1" &&
    typeof (value as { challengeId?: unknown }).challengeId === "string"
  ) {
    return value as Challenge;
  }
  return undefined;
}

async function loadClientIdentity(options: BrowserP2PConnectOptions): Promise<DeviceIdentity> {
  if (options.loadClientIdentity) {
    return options.loadClientIdentity();
  }

  const stored = localStorage.getItem(CLIENT_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as DeviceIdentity;
    } catch {
      localStorage.removeItem(CLIENT_IDENTITY_STORAGE_KEY);
    }
  }

  const identity = await createDeviceIdentity({
    deviceId: options.createClientId?.() ?? getOrCreateClientId(),
  });
  localStorage.setItem(CLIENT_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

function rememberTrustedHost(offer: BrowserPairingOffer): void {
  const store = loadTrustedDeviceStore();
  const trusted = trustHost(store, {
    hostId: offer.hostId,
    hostPublicKeyJwk: offer.hostPublicKeyJwk,
    displayName: offer.hostId,
  });
  localStorage.setItem(TRUSTED_DEVICE_STORE_KEY, JSON.stringify(trusted));
}

function loadTrustedDeviceStore(): TrustedDeviceStore {
  const stored = localStorage.getItem(TRUSTED_DEVICE_STORE_KEY);
  if (!stored) {
    return createTrustedDeviceStore();
  }

  try {
    return JSON.parse(stored) as TrustedDeviceStore;
  } catch {
    localStorage.removeItem(TRUSTED_DEVICE_STORE_KEY);
    return createTrustedDeviceStore();
  }
}

function nextRequestId(options: BrowserP2PConnectOptions, prefix: string): string {
  return options.createRequestId?.() ?? `${prefix}-${crypto.randomUUID()}`;
}

function getOrCreateClientId(): string {
  const stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (stored) {
    return stored;
  }
  const next = `client-${crypto.randomUUID()}`;
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
  return next;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}
