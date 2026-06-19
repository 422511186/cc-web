export interface TransportRequest<TBody = unknown> {
  readonly method?: string;
  readonly path: string;
  readonly body?: TBody;
  readonly headers?: Record<string, string>;
  readonly keepalive?: boolean;
}

export interface TransportSubscribeRequest<TEvent> {
  readonly path: string;
  readonly eventName?: string;
  readonly onEvent: (event: TEvent) => void;
  readonly onOpen?: () => void;
  readonly onError?: () => void;
}

export interface TransportStream {
  close(): void;
}

export interface CodeRelayTransport {
  request<TResponse, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TResponse>;

  subscribe<TEvent>(
    request: TransportSubscribeRequest<TEvent>
  ): TransportStream;
}

export interface TransportEventSource {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface HttpTransportOptions {
  readonly baseUrl?: string;
  readonly getAuthToken?: () => string | null;
  readonly onUnauthorized?: () => void;
  readonly fetchFn?: typeof fetch;
  readonly eventSourceFactory?: (url: string) => TransportEventSource;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export class HttpTransport implements CodeRelayTransport {
  private readonly baseUrl: string;
  private readonly getAuthToken: () => string | null;
  private readonly onUnauthorized?: () => void;
  private readonly fetchFn: typeof fetch;
  private readonly eventSourceFactory: (url: string) => TransportEventSource;

  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.getAuthToken = options.getAuthToken ?? (() => null);
    this.onUnauthorized = options.onUnauthorized;
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.eventSourceFactory =
      options.eventSourceFactory ??
      ((url) => new EventSource(url) as TransportEventSource);
  }

  async request<TResponse, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TResponse> {
    const headers: Record<string, string> = { ...(request.headers ?? {}) };
    const token = this.getAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let body: BodyInit | undefined;
    if (request.body !== undefined) {
      if (request.body instanceof FormData) {
        body = request.body;
      } else {
        headers["Content-Type"] ??= "application/json";
        body = JSON.stringify(request.body);
      }
    }

    const response = await this.fetchFn(this.urlFor(request.path), {
      method: request.method ?? "GET",
      headers,
      body,
      keepalive: request.keepalive,
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.onUnauthorized?.();
      }
      const error = await readError(response);
      throw new TransportError(error, response.status);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  }

  subscribe<TEvent>(
    request: TransportSubscribeRequest<TEvent>
  ): TransportStream {
    const source = this.eventSourceFactory(this.urlWithToken(request.path));
    const handleEvent = (event: { data: string }) => {
      try {
        request.onEvent(JSON.parse(event.data) as TEvent);
      } catch {
        // Ignore malformed frames and keep the stream alive.
      }
    };

    source.onopen = request.onOpen ?? null;
    source.onerror = request.onError ?? null;
    if (request.eventName) {
      source.addEventListener(request.eventName, handleEvent);
    } else {
      source.onmessage = handleEvent;
    }

    return {
      close: () => source.close(),
    };
  }

  private urlFor(path: string): string {
    if (!this.baseUrl) return path;
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  private urlWithToken(path: string): string {
    const url = this.urlFor(path);
    const token = this.getAuthToken();
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
}

export interface P2PMessagePort {
  send(message: string): void;
  addMessageListener(listener: (message: string) => void): () => void;
}

export interface P2PTransportOptions {
  readonly port: P2PMessagePort;
}

const P2P_WIRE_CHUNK_TYPE = "coderelay.wire_chunk.v1";
const P2P_WIRE_CHUNK_SIZE = 48 * 1024;
let nextWireMessageIndex = 0;

type P2PClientFrame =
  | {
      readonly type: "request";
      readonly id: string;
      readonly method: string;
      readonly path: string;
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
    }
  | {
      readonly type: "stream_open";
      readonly streamId: string;
      readonly path: string;
      readonly eventName?: string;
    }
  | {
      readonly type: "stream_close";
      readonly streamId: string;
    };

type P2PHostFrame =
  | {
      readonly type: "response";
      readonly id: string;
      readonly status: number;
      readonly body?: unknown;
    }
  | {
      readonly type: "stream_opened";
      readonly streamId: string;
    }
  | {
      readonly type: "stream_event";
      readonly streamId: string;
      readonly event: unknown;
    }
  | {
      readonly type: "stream_error";
      readonly streamId: string;
      readonly error?: string;
    }
  | {
      readonly type: "stream_closed";
      readonly streamId: string;
    };

interface P2PWireChunkFrame {
  readonly type: typeof P2P_WIRE_CHUNK_TYPE;
  readonly messageId: string;
  readonly index: number;
  readonly total: number;
  readonly data: string;
}

interface P2PSerializedFormDataBody {
  readonly __coderelayTransportBody: "form-data-v1";
  readonly fields: readonly P2PSerializedFormDataField[];
}

type P2PSerializedBody = P2PSerializedFormDataBody | unknown;

type P2PSerializedFormDataField =
  | {
      readonly kind: "field";
      readonly name: string;
      readonly value: string;
    }
  | {
      readonly kind: "file";
      readonly name: string;
      readonly filename: string;
      readonly contentType: string;
      readonly base64: string;
    };

interface PendingP2PRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface ActiveP2PStream<TEvent = unknown> {
  readonly onEvent: (event: TEvent) => void;
  readonly onOpen?: () => void;
  readonly onError?: () => void;
}

export class P2PTransport implements CodeRelayTransport {
  private nextRequestIndex = 0;
  private nextStreamIndex = 0;
  private readonly pendingRequests = new Map<string, PendingP2PRequest>();
  private readonly streams = new Map<string, ActiveP2PStream>();
  private readonly port: P2PMessagePort;

  constructor(private readonly options: P2PTransportOptions) {
    this.port = createChunkedMessagePort(options.port);
    this.port.addMessageListener((message) => this.handleMessage(message));
  }

  request<TResponse, TBody = unknown>(request: TransportRequest<TBody>): Promise<TResponse> {
    this.nextRequestIndex += 1;
    const id = `p2p-req-${this.nextRequestIndex}`;

    const response = new Promise<TResponse>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as TResponse),
        reject,
      });
    });
    void serializeP2PBody(request.body)
      .then((body) => {
        this.send({
          type: "request",
          id,
          method: request.method ?? "GET",
          path: request.path,
          body,
          headers: request.headers,
        });
      })
      .catch((error: unknown) => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        pending.reject(error instanceof Error ? error : new Error("Failed to serialize P2P request body"));
      });
    return response;
  }

  subscribe<TEvent>(request: TransportSubscribeRequest<TEvent>): TransportStream {
    this.nextStreamIndex += 1;
    const streamId = `p2p-stream-${this.nextStreamIndex}`;
    this.streams.set(streamId, {
      onEvent: request.onEvent as (event: unknown) => void,
      onOpen: request.onOpen,
      onError: request.onError,
    });
    this.send({
      type: "stream_open",
      streamId,
      path: request.path,
      eventName: request.eventName,
    });

    return {
      close: () => {
        if (!this.streams.has(streamId)) {
          return;
        }
        this.streams.delete(streamId);
        this.send({ type: "stream_close", streamId });
      },
    };
  }

  private handleMessage(message: string): void {
    let frame: P2PHostFrame;
    try {
      frame = JSON.parse(message) as P2PHostFrame;
    } catch {
      return;
    }

    switch (frame.type) {
      case "response":
        this.handleResponse(frame);
        break;
      case "stream_opened":
        this.streams.get(frame.streamId)?.onOpen?.();
        break;
      case "stream_event":
        this.streams.get(frame.streamId)?.onEvent(frame.event);
        break;
      case "stream_error":
        this.streams.get(frame.streamId)?.onError?.();
        break;
      case "stream_closed":
        this.streams.delete(frame.streamId);
        break;
    }
  }

  private handleResponse(frame: Extract<P2PHostFrame, { type: "response" }>): void {
    const pending = this.pendingRequests.get(frame.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(frame.id);
    if (frame.status >= 200 && frame.status < 300) {
      pending.resolve(frame.body);
      return;
    }

    pending.reject(new TransportError(readP2PError(frame.body, frame.status), frame.status));
  }

  private send(frame: P2PClientFrame): void {
    this.port.send(JSON.stringify(frame));
  }
}

export interface P2PBridgeRequest<TBody = unknown> {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly body?: TBody;
  readonly headers?: Record<string, string>;
}

export interface P2PBridgeResponse<TBody = unknown> {
  readonly status: number;
  readonly body?: TBody;
}

export interface P2PBridgeStreamRequest {
  readonly streamId: string;
  readonly path: string;
  readonly eventName?: string;
}

export interface P2PBridgeStreamSink {
  open(): void;
  event(event: unknown): void;
  error(error?: string): void;
  close(): void;
}

export interface P2PBridgeStreamHandle {
  close(): void;
}

export interface P2PBridgeHandlers {
  handleRequest(request: P2PBridgeRequest): Promise<P2PBridgeResponse> | P2PBridgeResponse;
  handleStream?(
    request: P2PBridgeStreamRequest,
    sink: P2PBridgeStreamSink
  ): P2PBridgeStreamHandle | Promise<P2PBridgeStreamHandle>;
}

export interface P2PBridge {
  close(): void;
}

export function createP2PBridge(port: P2PMessagePort, handlers: P2PBridgeHandlers): P2PBridge {
  const chunkedPort = createChunkedMessagePort(port);
  const activeStreams = new Map<string, P2PBridgeStreamHandle>();
  const removeListener = chunkedPort.addMessageListener((message) => {
    void handleBridgeMessage(chunkedPort, handlers, activeStreams, message);
  });

  return {
    close() {
      removeListener();
      for (const stream of activeStreams.values()) {
        stream.close();
      }
      activeStreams.clear();
    },
  };
}

async function readError(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function handleBridgeMessage(
  port: P2PMessagePort,
  handlers: P2PBridgeHandlers,
  activeStreams: Map<string, P2PBridgeStreamHandle>,
  message: string
): Promise<void> {
  let frame: P2PClientFrame;
  try {
    frame = JSON.parse(message) as P2PClientFrame;
  } catch {
    return;
  }

  switch (frame.type) {
    case "request":
      await handleBridgeRequest(port, handlers, frame);
      break;
    case "stream_open":
      await handleBridgeStreamOpen(port, handlers, activeStreams, frame);
      break;
    case "stream_close":
      activeStreams.get(frame.streamId)?.close();
      activeStreams.delete(frame.streamId);
      break;
  }
}

async function handleBridgeRequest(
  port: P2PMessagePort,
  handlers: P2PBridgeHandlers,
  frame: Extract<P2PClientFrame, { type: "request" }>
): Promise<void> {
  try {
    const response = await handlers.handleRequest({
      id: frame.id,
      method: frame.method,
      path: frame.path,
      body: deserializeP2PBody(frame.body),
      headers: frame.headers,
    });
    sendHostFrame(port, {
      type: "response",
      id: frame.id,
      status: response.status,
      body: response.body,
    });
  } catch (error) {
    sendHostFrame(port, {
      type: "response",
      id: frame.id,
      status: 500,
      body: { error: error instanceof Error ? error.message : "P2P request failed" },
    });
  }
}

async function handleBridgeStreamOpen(
  port: P2PMessagePort,
  handlers: P2PBridgeHandlers,
  activeStreams: Map<string, P2PBridgeStreamHandle>,
  frame: Extract<P2PClientFrame, { type: "stream_open" }>
): Promise<void> {
  if (!handlers.handleStream) {
    sendHostFrame(port, { type: "stream_error", streamId: frame.streamId, error: "P2P stream unsupported" });
    return;
  }

  const sink: P2PBridgeStreamSink = {
    open: () => sendHostFrame(port, { type: "stream_opened", streamId: frame.streamId }),
    event: (event) => sendHostFrame(port, { type: "stream_event", streamId: frame.streamId, event }),
    error: (error) => sendHostFrame(port, { type: "stream_error", streamId: frame.streamId, error }),
    close: () => sendHostFrame(port, { type: "stream_closed", streamId: frame.streamId }),
  };

  try {
    const handle = await handlers.handleStream(
      {
        streamId: frame.streamId,
        path: frame.path,
        eventName: frame.eventName,
      },
      sink
    );
    activeStreams.set(frame.streamId, handle);
  } catch (error) {
    sendHostFrame(port, {
      type: "stream_error",
      streamId: frame.streamId,
      error: error instanceof Error ? error.message : "P2P stream failed",
    });
  }
}

function sendHostFrame(port: P2PMessagePort, frame: P2PHostFrame): void {
  port.send(JSON.stringify(frame));
}

function createChunkedMessagePort(port: P2PMessagePort): P2PMessagePort {
  const pendingChunks = new Map<string, { readonly total: number; readonly chunks: string[]; count: number }>();

  return {
    send(message) {
      if (message.length <= P2P_WIRE_CHUNK_SIZE) {
        port.send(message);
        return;
      }

      nextWireMessageIndex += 1;
      const messageId = `chunk-${nextWireMessageIndex}`;
      const total = Math.ceil(message.length / P2P_WIRE_CHUNK_SIZE);
      for (let index = 0; index < total; index += 1) {
        const data = message.slice(index * P2P_WIRE_CHUNK_SIZE, (index + 1) * P2P_WIRE_CHUNK_SIZE);
        port.send(JSON.stringify({
          type: P2P_WIRE_CHUNK_TYPE,
          messageId,
          index,
          total,
          data,
        } satisfies P2PWireChunkFrame));
      }
    },
    addMessageListener(listener) {
      return port.addMessageListener((message) => {
        const chunk = parseWireChunk(message);
        if (!chunk) {
          listener(message);
          return;
        }

        const entry = pendingChunks.get(chunk.messageId) ?? {
          total: chunk.total,
          chunks: new Array<string>(chunk.total),
          count: 0,
        };
        if (chunk.index < 0 || chunk.index >= entry.total || entry.chunks[chunk.index] !== undefined) {
          return;
        }

        entry.chunks[chunk.index] = chunk.data;
        entry.count += 1;
        pendingChunks.set(chunk.messageId, entry);
        if (entry.count !== entry.total) {
          return;
        }

        pendingChunks.delete(chunk.messageId);
        listener(entry.chunks.join(""));
      });
    },
  };
}

function parseWireChunk(message: string): P2PWireChunkFrame | null {
  try {
    const frame = JSON.parse(message) as Partial<P2PWireChunkFrame>;
    const index = frame.index;
    const total = frame.total;
    if (
      frame.type === P2P_WIRE_CHUNK_TYPE &&
      typeof frame.messageId === "string" &&
      Number.isInteger(index) &&
      Number.isInteger(total) &&
      typeof frame.data === "string" &&
      typeof index === "number" &&
      typeof total === "number" &&
      total > 0
    ) {
      return {
        type: P2P_WIRE_CHUNK_TYPE,
        messageId: frame.messageId,
        index,
        total,
        data: frame.data,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function readP2PError(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }

  return `P2P ${status}`;
}

async function serializeP2PBody(body: unknown): Promise<P2PSerializedBody> {
  if (!isFormData(body)) {
    return body;
  }

  const fields: P2PSerializedFormDataField[] = [];
  for (const [name, value] of body.entries()) {
    if (typeof value === "string") {
      fields.push({ kind: "field", name, value });
      continue;
    }

    const file = value as File;
    const bytes = new Uint8Array(await file.arrayBuffer());
    fields.push({
      kind: "file",
      name,
      filename: typeof file.name === "string" && file.name ? file.name : "blob",
      contentType: file.type || "application/octet-stream",
      base64: bytesToBase64(bytes),
    });
  }

  return {
    __coderelayTransportBody: "form-data-v1",
    fields,
  };
}

function deserializeP2PBody(body: unknown): unknown {
  if (!isSerializedFormDataBody(body)) {
    return body;
  }

  const form = new FormData();
  for (const field of body.fields) {
    if (field.kind === "field") {
      form.append(field.name, field.value);
      continue;
    }

    const blob = new Blob([toArrayBuffer(base64ToBytes(field.base64))], { type: field.contentType });
    if (typeof File === "function") {
      form.append(field.name, new File([blob], field.filename, { type: field.contentType }));
    } else {
      form.append(field.name, blob, field.filename);
    }
  }
  return form;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData === "function" && value instanceof FormData;
}

function isSerializedFormDataBody(
  value: unknown
): value is P2PSerializedFormDataBody {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __coderelayTransportBody?: unknown }).__coderelayTransportBody === "form-data-v1" &&
    Array.isArray((value as { fields?: unknown }).fields)
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
