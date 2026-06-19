import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createDeviceIdentity,
  createTrustedDeviceStore,
  type DeviceIdentity,
  type TrustedDeviceStore,
} from "@coderelay/p2p-core";

export interface HostP2PState {
  readonly identity: DeviceIdentity;
  readonly trustedDeviceStore: TrustedDeviceStore;
  saveTrustedDeviceStore(store: TrustedDeviceStore): Promise<void>;
}

interface StoredHostP2PState {
  readonly identity: DeviceIdentity;
  readonly trustedDeviceStore: TrustedDeviceStore;
}

export async function loadOrCreateHostP2PState(stateFile: string, hostId: string): Promise<HostP2PState> {
  const stored = await readStoredState(stateFile);
  const state: StoredHostP2PState =
    stored?.identity.deviceId === hostId
      ? stored
      : {
          identity: await createDeviceIdentity({ deviceId: hostId }),
          trustedDeviceStore: createTrustedDeviceStore(),
        };

  await writeStoredState(stateFile, state);

  return {
    identity: state.identity,
    trustedDeviceStore: state.trustedDeviceStore,
    async saveTrustedDeviceStore(store: TrustedDeviceStore) {
      await writeStoredState(stateFile, {
        identity: state.identity,
        trustedDeviceStore: store,
      });
    },
  };
}

async function readStoredState(stateFile: string): Promise<StoredHostP2PState | null> {
  try {
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredHostP2PState>;
    if (!parsed.identity || !parsed.trustedDeviceStore) {
      return null;
    }
    return parsed as StoredHostP2PState;
  } catch {
    return null;
  }
}

async function writeStoredState(stateFile: string, state: StoredHostP2PState): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
