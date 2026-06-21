import { P2PTransport, type P2PMessagePort } from "@coderelay/transport";
import {
  createDeviceIdentity,
  createPairingProof,
  createTrustedDeviceStore,
  isTrustedHost,
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

export interface BrowserTrustedHostProfile {
  readonly protocol: "coderelay-trusted-host-v1";
  readonly webUrl: string;
  readonly signalUrl: string;
  readonly hostId: string;
  readonly hostPublicKeyJwk: JsonWebKey;
  readonly hostPublicKeyFingerprint: string;
  readonly updatedAt: string;
}

export interface BrowserP2PConnectOptions {
  readonly createWebSocket?: (url: string) => WebSocket;
  readonly createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
  readonly createClientId?: () => string;
  readonly createRequestId?: () => string;
  readonly loadClientIdentity?: () => Promise<DeviceIdentity>;
  readonly detectDeviceName?: () => string;
  readonly onDeviceRevoked?: (message: string) => void;
  readonly timeoutMs?: number;
}

type SignalMessage = Record<string, unknown> & { readonly type?: string };
type BrowserIceServer = RTCIceServer;

export interface BrowserPairCodeConnectOptions extends BrowserP2PConnectOptions {
  readonly signalUrl: string;
}

const DATA_CHANNEL_LABEL = "coderelay";
const CLIENT_ID_STORAGE_KEY = "coderelay-client-id";
const CLIENT_IDENTITY_STORAGE_KEY = "coderelay-client-identity-v1";
const TRUSTED_DEVICE_STORE_KEY = "coderelay-trusted-device-store-v1";
const LAST_TRUSTED_HOST_PROFILE_KEY = "coderelay-last-trusted-host-v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const TRUSTED_RECONNECT_REJECTED_MESSAGE = "此设备授权已失效，请在电脑端重新扫码或获取新的授权链接。";

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

export function loadLastTrustedHostProfile(): BrowserTrustedHostProfile | null {
  const stored = localStorage.getItem(LAST_TRUSTED_HOST_PROFILE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const profile = JSON.parse(stored) as unknown;
    if (!isTrustedHostProfile(profile)) {
      localStorage.removeItem(LAST_TRUSTED_HOST_PROFILE_KEY);
      return null;
    }

    if (!isTrustedHost(loadTrustedDeviceStore(), profile.hostId, profile.hostPublicKeyJwk)) {
      localStorage.removeItem(LAST_TRUSTED_HOST_PROFILE_KEY);
      return null;
    }

    return profile;
  } catch {
    localStorage.removeItem(LAST_TRUSTED_HOST_PROFILE_KEY);
    return null;
  }
}

export async function connectBrowserP2P(
  offer: BrowserPairingOffer,
  options: BrowserP2PConnectOptions = {},
): Promise<BrowserP2PSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const socket = await openSignalSocket(offer.signalUrl, options.createWebSocket, timeoutMs);
  const signal = new BrowserSignalClient(socket);

  return connectBrowserP2PWithSignal(offer, signal, socket, options, timeoutMs);
}

export async function connectBrowserP2PFromPairCode(
  pairCode: string,
  options: BrowserPairCodeConnectOptions,
): Promise<BrowserP2PSession> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const socket = await openSignalSocket(options.signalUrl, options.createWebSocket, timeoutMs);
  const signal = new BrowserSignalClient(socket);
  const requestId = nextRequestId(options, "lookup");

  signal.send({
    type: "pairing.lookup",
    requestId,
    pairCode,
  });

  const lookupReply = await signal.waitFor(
    (message) => (message.type === "pairing.offer" && message.requestId === requestId) || isSignalErrorForRequest(message, requestId),
    timeoutMs,
    "等待 Signal 返回配对信息超时",
  );
  throwIfSignalError(lookupReply);
  const offer = pairingOfferField(lookupReply, "offer");
  if (!offer) {
    throw new Error("Signal pairing offer is invalid");
  }

  return connectBrowserP2PWithSignal(offer, signal, socket, options, timeoutMs);
}

async function connectBrowserP2PWithSignal(
  offer: BrowserPairingOffer,
  signal: BrowserSignalClient,
  socket: WebSocket,
  options: BrowserP2PConnectOptions,
  timeoutMs: number,
): Promise<BrowserP2PSession> {
  const offerResult = verifyPairingOffer(offer);
  if (!offerResult.ok) {
    throw new Error(offerResult.reason === "expired" ? "配对链接已过期" : "配对链接无效");
  }

  const clientIdentity = await loadClientIdentity(options);
  const pairingRequestId = nextRequestId(options, "pair");
  const proof = await createPairingProof(offer, clientIdentity);

  signal.send({
    type: "pairing.request",
    requestId: pairingRequestId,
    hostId: offer.hostId,
    pairingId: offer.pairingId,
    clientId: clientIdentity.deviceId,
    clientPublicKeyJwk: clientIdentity.publicKeyJwk,
    clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
    displayName: detectDeviceName(options),
    proof,
  });

  const pairingReply = await signal.waitFor(
    (message) =>
      (
        (message.type === "pairing.accepted" || message.type === "pairing.rejected") &&
        message.requestId === pairingRequestId &&
        message.hostId === offer.hostId &&
        message.clientId === clientIdentity.deviceId
      ) ||
      isSignalErrorForRequest(message, pairingRequestId),
    timeoutMs,
    "等待 Host 接受设备配对超时",
  );
  throwIfSignalError(pairingReply);
  if (pairingReply.type === "pairing.rejected") {
    throw new Error(typeof pairingReply.reason === "string" ? pairingReply.reason : "设备配对被拒绝");
  }

  rememberTrustedHost(offer);

  return connectTrustedHostOverSignal({
    signal,
    socket,
    hostId: offer.hostId,
    clientIdentity,
    options,
    timeoutMs,
  });
}

export async function connectTrustedBrowserP2P(
  profile: BrowserTrustedHostProfile,
  options: BrowserP2PConnectOptions = {},
): Promise<BrowserP2PSession> {
  if (!isTrustedHostProfile(profile)) {
    throw new Error("可信 Host 配置无效");
  }

  if (!isTrustedHost(loadTrustedDeviceStore(), profile.hostId, profile.hostPublicKeyJwk)) {
    throw new Error("Host 未绑定或已被撤销");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clientIdentity = await loadClientIdentity(options);
  const socket = await openSignalSocket(profile.signalUrl, options.createWebSocket, timeoutMs);
  const signal = new BrowserSignalClient(socket);

  return connectTrustedHostOverSignal({
    signal,
    socket,
    hostId: profile.hostId,
    clientIdentity,
    options,
    timeoutMs,
  });
}

async function connectTrustedHostOverSignal({
  signal,
  socket,
  hostId,
  clientIdentity,
  options,
  timeoutMs,
}: {
  readonly signal: BrowserSignalClient;
  readonly socket: WebSocket;
  readonly hostId: string;
  readonly clientIdentity: DeviceIdentity;
  readonly options: BrowserP2PConnectOptions;
  readonly timeoutMs: number;
}): Promise<BrowserP2PSession> {
  const connectionRequestId = nextRequestId(options, "connect");

  signal.send({
    type: "client.connect",
    requestId: connectionRequestId,
    hostId,
    clientId: clientIdentity.deviceId,
    clientPublicKeyJwk: clientIdentity.publicKeyJwk,
    clientPublicKeyFingerprint: clientIdentity.publicKeyFingerprint,
  });

  const challengeMessage = await signal.waitFor(
    (message) =>
      (
        message.type === "connection.challenge" &&
        message.requestId === connectionRequestId &&
        message.hostId === hostId &&
        message.clientId === clientIdentity.deviceId
      ) ||
      isSignalErrorForRequest(message, connectionRequestId),
    timeoutMs,
    "等待 Host 连接挑战超时",
  );
  if (signalErrorReason(challengeMessage) === "untrusted_client") {
    removeTrustedHost(hostId);
    options.onDeviceRevoked?.(TRUSTED_RECONNECT_REJECTED_MESSAGE);
    throw new Error(TRUSTED_RECONNECT_REJECTED_MESSAGE);
  }
  throwIfSignalError(challengeMessage);
  const challenge = challengeField(challengeMessage, "challenge");
  if (!challenge) {
    throw new Error("Signal challenge did not include a valid challenge");
  }
  signal.send({
    type: "connection.challenge_response",
    requestId: connectionRequestId,
    hostId,
    clientId: clientIdentity.deviceId,
    proof: await signChallenge(clientIdentity, challenge),
  });

  const accepted = await signal.waitFor(
    (message) =>
      (
        message.type === "connection.accepted" &&
        message.requestId === connectionRequestId &&
        message.hostId === hostId &&
        message.clientId === clientIdentity.deviceId
      ) ||
      isSignalErrorForRequest(message, connectionRequestId),
    timeoutMs,
    "等待 Host 接受 P2P 连接超时",
  );
  throwIfSignalError(accepted);
  const connectionId = stringField(accepted, "connectionId");
  if (!connectionId) {
    throw new Error("Signal accepted connection without connectionId");
  }

  const iceServers = await requestIceServers(signal, options, Math.min(timeoutMs, 500));
  const peerConfig = { iceServers };
  const peer = options.createPeerConnection?.(peerConfig) ?? new RTCPeerConnection(peerConfig);
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

  const port = dataChannelPort(channel);
  const removeControlListener = port.addMessageListener((message) => {
    handleControlFrame(message, hostId, options);
  });
  const transport = new P2PTransport({ port });
  return {
    transport,
    connectionId,
    clientId: clientIdentity.deviceId,
    close() {
      removeControlListener();
      removeCandidateListener();
      channel.close();
      peer.close();
      socket.close();
    },
  };
}

async function requestIceServers(
  signal: BrowserSignalClient,
  options: BrowserP2PConnectOptions,
  timeoutMs: number,
): Promise<BrowserIceServer[]> {
  const requestId = nextRequestId(options, "turn");
  signal.send({
    type: "turn.get",
    requestId,
  });
  const reply = await signal.waitFor(
    (message) => (message.type === "turn.config" && message.requestId === requestId) || isSignalErrorForRequest(message, requestId),
    timeoutMs,
    "等待 Signal 返回 ICE 配置超时",
  ).catch(() => null);
  if (!reply || isSignalErrorForRequest(reply, requestId)) {
    return [];
  }
  const value = reply.iceServers;
  if (!Array.isArray(value)) {
    return [];
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
      urls: urls as string | string[],
      username: typeof (entry as { username?: unknown }).username === "string"
        ? (entry as { username: string }).username
        : undefined,
      credential: typeof (entry as { credential?: unknown }).credential === "string"
        ? (entry as { credential: string }).credential
        : undefined,
    }];
  });
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

function handleControlFrame(message: string, hostId: string, options: BrowserP2PConnectOptions): void {
  let frame: unknown;
  try {
    frame = JSON.parse(message) as unknown;
  } catch {
    return;
  }

  if (
    typeof frame !== "object" ||
    frame === null ||
    (frame as { type?: unknown }).type !== "event" ||
    typeof (frame as { event?: unknown }).event !== "object" ||
    (frame as { event?: { type?: unknown } }).event?.type !== "device_revoked"
  ) {
    return;
  }

  removeTrustedHost(hostId);
  const event = (frame as { event: { message?: unknown } }).event;
  options.onDeviceRevoked?.(
    typeof event.message === "string" ? event.message : "此设备授权已被 Host 撤销，请重新授权"
  );
}

function stringField(message: SignalMessage, key: string): string | undefined {
  const value = message[key];
  return typeof value === "string" ? value : undefined;
}

function pairingOfferField(message: SignalMessage, key: string): BrowserPairingOffer | undefined {
  const value = message[key];
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === "coderelay-pairing-v1" &&
    typeof (value as { signalUrl?: unknown }).signalUrl === "string" &&
    typeof (value as { hostId?: unknown }).hostId === "string" &&
    typeof (value as { hostPublicKeyJwk?: unknown }).hostPublicKeyJwk === "object"
  ) {
    return value as BrowserPairingOffer;
  }
  return undefined;
}

function isSignalErrorForRequest(message: SignalMessage, requestId: string): boolean {
  return message.type === "signal.error" && message.requestId === requestId;
}

function signalErrorReason(message: SignalMessage): string | undefined {
  return message.type === "signal.error" ? stringField(message, "reason") : undefined;
}

function throwIfSignalError(message: SignalMessage): void {
  if (message.type !== "signal.error") {
    return;
  }

  throw new Error(signalErrorMessage(stringField(message, "reason")));
}

function signalErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case "host_offline":
      return "Host 当前未连接到 CodeRelay Signal";
    case "pairing_not_found":
      return "配对二维码已失效，请在电脑端重新生成";
    case "pairing_expired":
      return "配对二维码已过期，请在电脑端重新生成";
    case "connection_not_found":
      return "P2P 连接已失效，请重新连接";
    case "untrusted_client":
      return TRUSTED_RECONNECT_REJECTED_MESSAGE;
    default:
      return reason ? `Signal 返回错误：${reason}` : "Signal 返回未知错误";
  }
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

function isTrustedHostProfile(value: unknown): value is BrowserTrustedHostProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const profile = value as Partial<BrowserTrustedHostProfile>;
  return (
    profile.protocol === "coderelay-trusted-host-v1" &&
    typeof profile.webUrl === "string" &&
    typeof profile.signalUrl === "string" &&
    typeof profile.hostId === "string" &&
    typeof profile.hostPublicKeyFingerprint === "string" &&
    typeof profile.updatedAt === "string" &&
    typeof profile.hostPublicKeyJwk === "object" &&
    profile.hostPublicKeyJwk !== null
  );
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
  localStorage.setItem(LAST_TRUSTED_HOST_PROFILE_KEY, JSON.stringify({
    protocol: "coderelay-trusted-host-v1",
    webUrl: offer.webUrl,
    signalUrl: offer.signalUrl,
    hostId: offer.hostId,
    hostPublicKeyJwk: offer.hostPublicKeyJwk,
    hostPublicKeyFingerprint: offer.hostPublicKeyFingerprint,
    updatedAt: new Date().toISOString(),
  } satisfies BrowserTrustedHostProfile));
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

function removeTrustedHost(hostId: string): void {
  const store = loadTrustedDeviceStore();
  localStorage.setItem(TRUSTED_DEVICE_STORE_KEY, JSON.stringify({
    ...store,
    trustedHosts: store.trustedHosts.filter((host) => host.hostId !== hostId),
  } satisfies TrustedDeviceStore));
  localStorage.removeItem(LAST_TRUSTED_HOST_PROFILE_KEY);
}

function nextRequestId(options: BrowserP2PConnectOptions, prefix: string): string {
  return options.createRequestId?.() ?? `${prefix}-${createRandomId()}`;
}

function getOrCreateClientId(): string {
  const stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (stored) {
    return stored;
  }
  const next = `client-${createRandomId()}`;
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
  return next;
}

function detectDeviceName(options: BrowserP2PConnectOptions): string {
  if (options.detectDeviceName) {
    return options.detectDeviceName();
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string; brands?: Array<{ brand: string }> } }).userAgentData;
  const brand = userAgentData?.brands?.find((entry) => !entry.brand.includes("Not"))?.brand;
  const platform = userAgentData?.platform;
  if (brand && platform) {
    return `${brand} on ${platform}`;
  }

  if (/Android/i.test(navigator.userAgent)) {
    return "Chrome on Android";
  }
  if (/iPhone|iPad/i.test(navigator.userAgent)) {
    return "Safari on iOS";
  }
  return "此设备";
}

function createRandomId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}
