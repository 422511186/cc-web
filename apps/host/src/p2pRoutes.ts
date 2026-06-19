import { Router } from "express";
import type { JsonWebKey } from "node:crypto";
import QRCode from "qrcode";

export type P2PPeerStatus = "connecting" | "connected" | "disconnected";
export type P2PSignalStatus = "connecting" | "connected" | "disconnected";
export type P2PManagedTransport = "p2p" | "http";

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
    readonly pairCode: string;
    readonly pairingId: string;
    readonly expiresAt: string;
    readonly pairingUrl: string;
  };
}

export interface P2PPairingResult {
  readonly pairCode: string;
  readonly offer: HostPairingOffer;
  readonly pairingUrl: string;
}

export interface P2PPairingResponse extends P2PPairingResult {
  readonly qrDataUrl: string;
}

export interface P2PManagedDevice {
  readonly clientId: string;
  readonly displayName?: string;
  readonly addedAt: string;
  readonly lastUsedAt?: string;
  readonly lastTransport?: P2PManagedTransport;
  readonly revokedAt?: string;
}

export interface P2PTopology {
  readonly signalUrl?: string;
  readonly hostId?: string;
  readonly signalStatus: P2PSignalStatus;
  readonly peerStatus: P2PPeerStatus;
  readonly iceLocalAddresses: readonly string[];
  readonly turnConfigured: boolean;
  readonly iceServers: readonly {
    readonly urls: string | readonly string[];
    readonly hasUsername: boolean;
    readonly hasCredential: boolean;
  }[];
  readonly activeConnection?: {
    readonly clientId: string;
    readonly connectionId: string;
    readonly transport: "p2p";
    readonly route: string;
  };
}

export interface P2PManagementState {
  readonly devices: readonly P2PManagedDevice[];
  readonly topology: P2PTopology;
}

export interface P2PSettings {
  readonly webUrl: string;
  readonly signalUrl: string;
}

export interface HostP2PRuntimeApi {
  getStatus(): P2PStatus;
  openPairing(options: { readonly webUrl?: string }): P2PPairingResult;
  getSettings(): P2PSettings;
  updateSettings(settings: Partial<P2PSettings>): P2PSettings;
  getManagementState(): P2PManagementState;
  revokeDevice(clientId: string): Promise<{ readonly ok: boolean; readonly clientId: string }>;
}

export function createP2PRouter(runtime?: HostP2PRuntimeApi): Router {
  const router = Router();

  router.get("/host/settings", (_req, res) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    res.json(runtime.getSettings());
  });

  router.patch("/host/settings", (req, res) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    res.json(runtime.updateSettings({
      webUrl: typeof req.body?.webUrl === "string" ? req.body.webUrl : undefined,
      signalUrl: typeof req.body?.signalUrl === "string" ? req.body.signalUrl : undefined,
    }));
  });

  router.get("/p2p/status", (_req, res) => {
    if (!runtime) {
      res.json({ enabled: false });
      return;
    }

    res.json(runtime.getStatus());
  });

  router.post("/p2p/pairing", async (req, res, next) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    try {
      const pairing = runtime.openPairing({});
      const response: P2PPairingResponse = {
        ...pairing,
        qrDataUrl: await QRCode.toDataURL(pairing.pairingUrl, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.get("/p2p/management", (_req, res) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    res.json(runtime.getManagementState());
  });

  router.delete("/p2p/devices/:clientId", async (req, res, next) => {
    if (!runtime) {
      res.status(503).json({ error: "P2P runtime is not enabled" });
      return;
    }

    try {
      res.json(await runtime.revokeDevice(req.params.clientId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
