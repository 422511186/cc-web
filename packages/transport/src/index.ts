export interface TransportScaffold {
  readonly packageName: "@coderelay/transport";
}

export function createTransportScaffold(): TransportScaffold {
  return { packageName: "@coderelay/transport" };
}
