export interface DeviceIdentity {
  readonly deviceId: string;
  readonly publicKeyJwk: JsonWebKey;
  readonly privateKeyJwk: JsonWebKey;
  readonly publicKeyFingerprint: string;
  readonly createdAt: string;
}

export interface PublicDeviceDescriptor {
  readonly deviceId: string;
  readonly publicKeyJwk: JsonWebKey;
  readonly publicKeyFingerprint: string;
}

export interface CreateDeviceIdentityOptions {
  readonly deviceId?: string;
  readonly createdAt?: string;
}

export interface TrustedClient {
  readonly clientId: string;
  readonly clientPublicKeyJwk: JsonWebKey;
  readonly displayName?: string;
  readonly addedAt: string;
  readonly revokedAt?: string;
}

export interface TrustedHost {
  readonly hostId: string;
  readonly hostPublicKeyJwk: JsonWebKey;
  readonly displayName?: string;
  readonly addedAt: string;
  readonly revokedAt?: string;
}

export interface TrustedDeviceStore {
  readonly trustedClients: TrustedClient[];
  readonly trustedHosts: TrustedHost[];
}

export interface PairingOffer {
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

export interface CreatePairingOfferOptions {
  readonly webUrl: string;
  readonly signalUrl: string;
  readonly host: DeviceIdentity | PublicDeviceDescriptor;
  readonly pairingId?: string;
  readonly pairingSecret?: string;
  readonly now?: number;
  readonly ttlMs?: number;
}

export interface PairingProof {
  readonly protocol: "coderelay-pairing-proof-v1";
  readonly pairingId: string;
  readonly clientId: string;
  readonly clientPublicKeyJwk: JsonWebKey;
  readonly clientPublicKeyFingerprint: string;
  readonly signature: string;
}

export interface Challenge {
  readonly protocol: "coderelay-challenge-v1";
  readonly challengeId: string;
  readonly nonce: string;
  readonly issuedAt: string;
}

export interface ChallengeProof {
  readonly protocol: "coderelay-challenge-proof-v1";
  readonly deviceId: string;
  readonly publicKeyFingerprint: string;
  readonly challengeId: string;
  readonly signature: string;
}

const KEY_ALGORITHM: EcKeyGenParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};

const SIGN_ALGORITHM: EcdsaParams = {
  name: "ECDSA",
  hash: "SHA-256",
};

const DEFAULT_PAIRING_TTL_MS = 2 * 60 * 1000;

export async function createDeviceIdentity(options: CreateDeviceIdentityOptions = {}): Promise<DeviceIdentity> {
  const keyPair = (await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

  return {
    deviceId: options.deviceId ?? createId("device"),
    publicKeyJwk,
    privateKeyJwk,
    publicKeyFingerprint: await fingerprintPublicKey(publicKeyJwk),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export function toPublicDeviceDescriptor(identity: DeviceIdentity): PublicDeviceDescriptor {
  return {
    deviceId: identity.deviceId,
    publicKeyJwk: identity.publicKeyJwk,
    publicKeyFingerprint: identity.publicKeyFingerprint,
  };
}

export function createTrustedDeviceStore(): TrustedDeviceStore {
  return {
    trustedClients: [],
    trustedHosts: [],
  };
}

export function trustClient(
  store: TrustedDeviceStore,
  client: {
    readonly clientId: string;
    readonly clientPublicKeyJwk: JsonWebKey;
    readonly displayName?: string;
    readonly addedAt?: string;
  },
): TrustedDeviceStore {
  const nextClient: TrustedClient = {
    clientId: client.clientId,
    clientPublicKeyJwk: client.clientPublicKeyJwk,
    displayName: client.displayName,
    addedAt: client.addedAt ?? new Date().toISOString(),
    revokedAt: undefined,
  };

  return {
    ...store,
    trustedClients: [...store.trustedClients.filter((entry) => entry.clientId !== client.clientId), nextClient],
  };
}

export function revokeClient(
  store: TrustedDeviceStore,
  clientId: string,
  options: { readonly revokedAt?: string } = {},
): TrustedDeviceStore {
  return {
    ...store,
    trustedClients: store.trustedClients.map((entry) =>
      entry.clientId === clientId ? { ...entry, revokedAt: options.revokedAt ?? new Date().toISOString() } : entry,
    ),
  };
}

export function isTrustedClient(store: TrustedDeviceStore, clientId: string, clientPublicKeyJwk: JsonWebKey): boolean {
  return store.trustedClients.some(
    (entry) =>
      entry.clientId === clientId &&
      entry.revokedAt === undefined &&
      sameJson(entry.clientPublicKeyJwk, clientPublicKeyJwk),
  );
}

export function trustHost(
  store: TrustedDeviceStore,
  host: {
    readonly hostId: string;
    readonly hostPublicKeyJwk: JsonWebKey;
    readonly displayName?: string;
    readonly addedAt?: string;
  },
): TrustedDeviceStore {
  const nextHost: TrustedHost = {
    hostId: host.hostId,
    hostPublicKeyJwk: host.hostPublicKeyJwk,
    displayName: host.displayName,
    addedAt: host.addedAt ?? new Date().toISOString(),
    revokedAt: undefined,
  };

  return {
    ...store,
    trustedHosts: [...store.trustedHosts.filter((entry) => entry.hostId !== host.hostId), nextHost],
  };
}

export function isTrustedHost(store: TrustedDeviceStore, hostId: string, hostPublicKeyJwk: JsonWebKey): boolean {
  return store.trustedHosts.some(
    (entry) =>
      entry.hostId === hostId && entry.revokedAt === undefined && sameJson(entry.hostPublicKeyJwk, hostPublicKeyJwk),
  );
}

export function createPairingOffer(options: CreatePairingOfferOptions): PairingOffer {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS;

  return {
    protocol: "coderelay-pairing-v1",
    webUrl: options.webUrl,
    signalUrl: options.signalUrl,
    hostId: options.host.deviceId,
    hostPublicKeyJwk: options.host.publicKeyJwk,
    hostPublicKeyFingerprint: options.host.publicKeyFingerprint,
    pairingId: options.pairingId ?? createId("pair"),
    pairingSecret: options.pairingSecret ?? createSecret(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

export function verifyPairingOffer(
  offer: PairingOffer,
  options: { readonly now?: number } = {},
): { readonly ok: true } | { readonly ok: false; readonly reason: "expired" | "invalid_protocol" } {
  if (offer.protocol !== "coderelay-pairing-v1") {
    return { ok: false, reason: "invalid_protocol" };
  }

  if ((options.now ?? Date.now()) > Date.parse(offer.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true };
}

export async function createPairingProof(offer: PairingOffer, client: DeviceIdentity): Promise<PairingProof> {
  const signature = await signPayload(client.privateKeyJwk, pairingProofPayload(offer, client));

  return {
    protocol: "coderelay-pairing-proof-v1",
    pairingId: offer.pairingId,
    clientId: client.deviceId,
    clientPublicKeyJwk: client.publicKeyJwk,
    clientPublicKeyFingerprint: client.publicKeyFingerprint,
    signature,
  };
}

export async function acceptPairingProof(
  store: TrustedDeviceStore,
  offer: PairingOffer,
  proof: PairingProof,
  options: { readonly now?: number; readonly displayName?: string; readonly addedAt?: string } = {},
): Promise<
  | { readonly ok: true; readonly store: TrustedDeviceStore }
  | { readonly ok: false; readonly reason: "expired" | "invalid_pairing" | "invalid_signature"; readonly store: TrustedDeviceStore }
> {
  const offerResult = verifyPairingOffer(offer, { now: options.now });
  if (!offerResult.ok) {
    return { ok: false, reason: offerResult.reason === "expired" ? "expired" : "invalid_pairing", store };
  }

  if (proof.protocol !== "coderelay-pairing-proof-v1" || proof.pairingId !== offer.pairingId) {
    return { ok: false, reason: "invalid_pairing", store };
  }

  const isValid = await verifyPayloadSignature(
    proof.clientPublicKeyJwk,
    pairingProofPayload(offer, {
      deviceId: proof.clientId,
      publicKeyJwk: proof.clientPublicKeyJwk,
      publicKeyFingerprint: proof.clientPublicKeyFingerprint,
    }),
    proof.signature,
  );
  if (!isValid) {
    return { ok: false, reason: "invalid_signature", store };
  }

  return {
    ok: true,
    store: trustClient(store, {
      clientId: proof.clientId,
      clientPublicKeyJwk: proof.clientPublicKeyJwk,
      displayName: options.displayName,
      addedAt: options.addedAt ?? new Date(options.now ?? Date.now()).toISOString(),
    }),
  };
}

export function createChallenge(options: {
  readonly challengeId?: string;
  readonly nonce?: string;
  readonly issuedAt?: string;
} = {}): Challenge {
  return {
    protocol: "coderelay-challenge-v1",
    challengeId: options.challengeId ?? createId("challenge"),
    nonce: options.nonce ?? createSecret(),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
}

export async function signChallenge(identity: DeviceIdentity, challenge: Challenge): Promise<ChallengeProof> {
  return {
    protocol: "coderelay-challenge-proof-v1",
    deviceId: identity.deviceId,
    publicKeyFingerprint: identity.publicKeyFingerprint,
    challengeId: challenge.challengeId,
    signature: await signPayload(identity.privateKeyJwk, challengePayload(challenge)),
  };
}

export async function verifyChallengeSignature(
  publicKeyJwk: JsonWebKey,
  challenge: Challenge,
  signature: string,
): Promise<boolean> {
  return verifyPayloadSignature(publicKeyJwk, challengePayload(challenge), signature);
}

export async function authorizeClientChallenge(
  store: TrustedDeviceStore,
  request: {
    readonly clientId: string;
    readonly clientPublicKeyJwk: JsonWebKey;
    readonly challenge: Challenge;
    readonly signature: string;
  },
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "untrusted_client" | "invalid_signature" }> {
  if (!isTrustedClient(store, request.clientId, request.clientPublicKeyJwk)) {
    return { ok: false, reason: "untrusted_client" };
  }

  const isValid = await verifyChallengeSignature(request.clientPublicKeyJwk, request.challenge, request.signature);
  if (!isValid) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
}

async function fingerprintPublicKey(publicKeyJwk: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encodeText(stableStringify(publicKeyJwk)));
  return bytesToBase64Url(new Uint8Array(digest));
}

function pairingProofPayload(
  offer: Pick<PairingOffer, "pairingId" | "pairingSecret">,
  client: Pick<PublicDeviceDescriptor, "deviceId" | "publicKeyJwk" | "publicKeyFingerprint">,
): unknown {
  return {
    protocol: "coderelay-pairing-proof-v1",
    pairingId: offer.pairingId,
    pairingSecret: offer.pairingSecret,
    clientId: client.deviceId,
    clientPublicKeyJwk: client.publicKeyJwk,
    clientPublicKeyFingerprint: client.publicKeyFingerprint,
  };
}

function challengePayload(challenge: Challenge): unknown {
  return {
    protocol: challenge.protocol,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
  };
}

async function signPayload(privateKeyJwk: JsonWebKey, payload: unknown): Promise<string> {
  const privateKey = await crypto.subtle.importKey("jwk", privateKeyJwk, KEY_ALGORITHM, false, ["sign"]);
  const signature = await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, encodeText(stableStringify(payload)));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyPayloadSignature(publicKeyJwk: JsonWebKey, payload: unknown, signature: string): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("jwk", publicKeyJwk, KEY_ALGORITHM, false, ["verify"]);
    return crypto.subtle.verify(
      SIGN_ALGORITHM,
      publicKey,
      toArrayBuffer(base64UrlToBytes(signature)),
      encodeText(stableStringify(payload)),
    );
  } catch {
    return false;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function encodeText(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createId(prefix: string): string {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${createSecret()}`;
}

function createSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
