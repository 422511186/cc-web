import { RTCDataChannel, RTCPeerConnection } from "werift";

export type PeerStatus = "connecting" | "connected" | "disconnected";
export type SignalStatus = "connected" | "disconnected";

export interface DataChannelRpcRequest<TBody = unknown> {
  readonly id: string;
  readonly body: TBody;
}

export type DataChannelRpcHandler = (request: DataChannelRpcRequest) => unknown | Promise<unknown>;

export interface DataChannelRpcPeer {
  readonly peerStatus: PeerStatus;
  readonly signalStatus: SignalStatus;
  setSignalStatus(status: SignalStatus): void;
  request<TResponse = unknown, TBody = unknown>(body: TBody): Promise<TResponse>;
  handleRequests(handler: DataChannelRpcHandler): void;
  closeDataChannel(): void;
}

export interface WeriftDataChannelPair {
  readonly client: DataChannelRpcPeer;
  readonly host: DataChannelRpcPeer;
  reconnect(): Promise<void>;
  close(): Promise<void>;
}

type RpcFrame =
  | { readonly type: "p2p.request"; readonly id: string; readonly body: unknown }
  | { readonly type: "p2p.response"; readonly id: string; readonly ok: true; readonly body: unknown }
  | { readonly type: "p2p.response"; readonly id: string; readonly ok: false; readonly error: string };

const DATA_CHANNEL_LABEL = "coderelay";
const REQUEST_TIMEOUT_MS = 5_000;
const DISCONNECTED_ERROR = "P2P data channel is not connected";

export async function createWeriftDataChannelPair(): Promise<WeriftDataChannelPair> {
  const pair = new WeriftDataChannelPairImpl();
  await pair.reconnect();
  return pair;
}

class WeriftDataChannelPairImpl implements WeriftDataChannelPair {
  readonly client = new DataChannelRpcPeerImpl();
  readonly host = new DataChannelRpcPeerImpl();
  private clientConnection?: RTCPeerConnection;
  private hostConnection?: RTCPeerConnection;

  async reconnect(): Promise<void> {
    await this.closePeerConnections();
    this.client.markConnecting();
    this.host.markConnecting();

    const clientConnection = new RTCPeerConnection();
    const hostConnection = new RTCPeerConnection();
    const hostChannel = new Promise<RTCDataChannel>((resolve) => {
      hostConnection.ondatachannel = (event) => resolve(event.channel);
    });
    const clientChannel = clientConnection.createDataChannel(DATA_CHANNEL_LABEL);

    const offer = await clientConnection.createOffer();
    await clientConnection.setLocalDescription(offer);
    await hostConnection.setRemoteDescription(clientConnection.localDescription!);
    const answer = await hostConnection.createAnswer();
    await hostConnection.setLocalDescription(answer);
    await clientConnection.setRemoteDescription(hostConnection.localDescription!);

    const resolvedHostChannel = await hostChannel;
    this.clientConnection = clientConnection;
    this.hostConnection = hostConnection;
    this.client.attachDataChannel(clientChannel);
    this.host.attachDataChannel(resolvedHostChannel);
    await waitFor(
      () => clientChannel.readyState === "open" && resolvedHostChannel.readyState === "open",
      "Timed out waiting for WebRTC DataChannel to open",
    );
    this.client.markConnected();
    this.host.markConnected();
  }

  async close(): Promise<void> {
    await this.closePeerConnections();
    this.client.markDisconnected();
    this.host.markDisconnected();
  }

  private async closePeerConnections(): Promise<void> {
    this.client.closeDataChannel();
    this.host.closeDataChannel();
    const connections = [this.clientConnection, this.hostConnection];
    this.clientConnection = undefined;
    this.hostConnection = undefined;

    await Promise.all(
      connections.map(async (connection) => {
        if (!connection) {
          return;
        }
        await connection.close();
      }),
    );
  }
}

class DataChannelRpcPeerImpl implements DataChannelRpcPeer {
  private channel?: RTCDataChannel;
  private requestHandler?: DataChannelRpcHandler;
  private nextRequestIndex = 0;
  private readonly pending = new Map<
    string,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private currentPeerStatus: PeerStatus = "disconnected";
  private currentSignalStatus: SignalStatus = "connected";

  get peerStatus(): PeerStatus {
    return this.currentPeerStatus;
  }

  get signalStatus(): SignalStatus {
    return this.currentSignalStatus;
  }

  setSignalStatus(status: SignalStatus): void {
    this.currentSignalStatus = status;
  }

  request<TResponse = unknown, TBody = unknown>(body: TBody): Promise<TResponse> {
    if (!this.channel || this.currentPeerStatus !== "connected" || this.channel.readyState !== "open") {
      return Promise.reject(new Error(DISCONNECTED_ERROR));
    }

    this.nextRequestIndex += 1;
    const id = `req-${this.nextRequestIndex}`;
    const promise = new Promise<TResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`P2P request timed out: ${id}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResponse),
        reject,
        timeout,
      });
    });

    this.sendFrame({ type: "p2p.request", id, body });
    return promise;
  }

  handleRequests(handler: DataChannelRpcHandler): void {
    this.requestHandler = handler;
  }

  closeDataChannel(): void {
    this.channel?.close();
    this.markDisconnected();
  }

  attachDataChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.currentPeerStatus = channel.readyState === "open" ? "connected" : "connecting";
    channel.onopen = () => {
      this.markConnected();
    };
    channel.onclose = () => {
      if (this.channel === channel) {
        this.markDisconnected();
      }
    };
    channel.onerror = () => {
      if (this.channel === channel) {
        this.markDisconnected();
      }
    };
    channel.onmessage = (event) => {
      void this.handleRawMessage(event.data);
    };
  }

  markConnecting(): void {
    this.currentPeerStatus = "connecting";
  }

  markConnected(): void {
    this.currentPeerStatus = "connected";
  }

  markDisconnected(): void {
    this.currentPeerStatus = "disconnected";
    this.channel = undefined;
    this.rejectPending(new Error(DISCONNECTED_ERROR));
  }

  private async handleRawMessage(data: string | Buffer): Promise<void> {
    let frame: RpcFrame;
    try {
      frame = JSON.parse(data.toString()) as RpcFrame;
    } catch {
      return;
    }

    if (frame.type === "p2p.request") {
      await this.handleRequestFrame(frame);
      return;
    }

    if (frame.type === "p2p.response") {
      this.handleResponseFrame(frame);
    }
  }

  private async handleRequestFrame(frame: Extract<RpcFrame, { type: "p2p.request" }>): Promise<void> {
    if (!this.requestHandler) {
      this.sendFrame({
        type: "p2p.response",
        id: frame.id,
        ok: false,
        error: "No P2P request handler registered",
      });
      return;
    }

    try {
      const body = await this.requestHandler({ id: frame.id, body: frame.body });
      this.sendFrame({ type: "p2p.response", id: frame.id, ok: true, body });
    } catch (error) {
      this.sendFrame({
        type: "p2p.response",
        id: frame.id,
        ok: false,
        error: error instanceof Error ? error.message : "P2P request failed",
      });
    }
  }

  private handleResponseFrame(frame: Extract<RpcFrame, { type: "p2p.response" }>): void {
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.body);
    } else {
      pending.reject(new Error(frame.error));
    }
  }

  private sendFrame(frame: RpcFrame): void {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error(DISCONNECTED_ERROR);
    }
    this.channel.send(JSON.stringify(frame));
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

async function waitFor(predicate: () => boolean, errorMessage: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(errorMessage);
}
