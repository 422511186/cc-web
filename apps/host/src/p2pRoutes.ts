import { Router } from "express";
import type { JsonWebKey } from "node:crypto";

export type P2PPeerStatus = "connecting" | "connected" | "disconnected";
export type P2PSignalStatus = "connecting" | "connected" | "disconnected";

export interface HostPairingOffer {
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

export interface P2PStatus {
  readonly enabled: boolean;
  readonly signalStatus?: P2PSignalStatus;
  readonly peerStatus?: P2PPeerStatus;
  readonly hostId?: string;
  readonly signalUrl?: string;
  readonly activePairing?: {
    readonly pairingId: string;
    readonly expiresAt: string;
    readonly pairingUrl: string;
  };
}

export interface P2PPairingResult {
  readonly offer: HostPairingOffer;
  readonly pairingUrl: string;
}

export interface HostP2PRuntimeApi {
  getStatus(): P2PStatus;
  openPairing(options: { readonly webUrl?: string }): P2PPairingResult;
}

export function createP2PRouter(runtime?: HostP2PRuntimeApi): Router {
  const router = Router();

  router.get("/p2p/status", (_req, res) => {
    if (!runtime) {
      res.json({ enabled: false });
      return;
    }

    res.json(runtime.getStatus());
  });

  router.post("/p2p/pairing", (req, res) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    res.json(
      runtime.openPairing({
        webUrl: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
      })
    );
  });

  return router;
}
