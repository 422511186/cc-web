export interface P2pCoreScaffold {
  readonly packageName: "@coderelay/p2p-core";
}

export function createP2pCoreScaffold(): P2pCoreScaffold {
  return { packageName: "@coderelay/p2p-core" };
}
