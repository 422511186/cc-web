import type {
  P2PBridgeHandlers,
  P2PBridgeRequest,
  P2PBridgeResponse,
  P2PBridgeStreamHandle,
  P2PBridgeStreamRequest,
  P2PBridgeStreamSink,
} from "@coderelay/transport";

export interface LocalHttpP2PBridgeOptions {
  readonly baseUrl: string;
  readonly authToken?: string;
  readonly fetchFn?: typeof fetch;
}

export function createLocalHttpP2PBridgeHandlers(options: LocalHttpP2PBridgeOptions): P2PBridgeHandlers {
  const fetchFn = options.fetchFn ?? fetch;

  return {
    handleRequest: (request) => forwardRequest(fetchFn, options, request),
    handleStream: (request, sink) => forwardStream(fetchFn, options, request, sink),
  };
}

async function forwardRequest(
  fetchFn: typeof fetch,
  options: LocalHttpP2PBridgeOptions,
  request: P2PBridgeRequest,
): Promise<P2PBridgeResponse> {
  const response = await fetchFn(urlFor(options.baseUrl, request.path), {
    method: request.method,
    headers: headersFor(options, request.headers, request.body),
    body: bodyFor(request.body),
    signal: undefined,
  });

  if (response.status === 204) {
    return { status: 204, body: undefined };
  }

  return {
    status: response.status,
    body: await readJsonBody(response),
  };
}

function forwardStream(
  fetchFn: typeof fetch,
  options: LocalHttpP2PBridgeOptions,
  request: P2PBridgeStreamRequest,
  sink: P2PBridgeStreamSink,
): P2PBridgeStreamHandle {
  const abortController = new AbortController();

  void pumpSse(fetchFn, options, request, sink, abortController.signal);

  return {
    close() {
      abortController.abort();
    },
  };
}

async function pumpSse(
  fetchFn: typeof fetch,
  options: LocalHttpP2PBridgeOptions,
  request: P2PBridgeStreamRequest,
  sink: P2PBridgeStreamSink,
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await fetchFn(urlFor(options.baseUrl, request.path), {
      method: "GET",
      headers: headersFor(options, { Accept: "text/event-stream" }),
      signal,
    });

    if (!response.ok) {
      sink.error(`HTTP ${response.status}`);
      sink.close();
      return;
    }

    sink.open();
    await readSseBody(response.body, sink);
    sink.close();
  } catch (error) {
    if (!signal.aborted) {
      sink.error(error instanceof Error ? error.message : "SSE bridge failed");
      sink.close();
    }
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function readSseBody(body: ReadableStream<Uint8Array> | null, sink: P2PBridgeStreamSink): Promise<void> {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      flushSseBuffer(buffer, sink, true);
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = flushSseBuffer(buffer, sink, false);
  }
}

function flushSseBuffer(buffer: string, sink: P2PBridgeStreamSink, flushAll: boolean): string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const completeFrames = flushAll ? frames : frames.slice(0, -1);

  for (const frame of completeFrames) {
    emitSseFrame(frame, sink);
  }

  return flushAll ? "" : frames.at(-1) ?? "";
}

function emitSseFrame(frame: string, sink: P2PBridgeStreamSink): void {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) {
    return;
  }

  try {
    sink.event(JSON.parse(data));
  } catch {
    // Ignore malformed SSE payloads and keep the stream alive.
  }
}

function headersFor(
  options: LocalHttpP2PBridgeOptions,
  headers: Record<string, string> = {},
  body?: unknown,
): Record<string, string> {
  const nextHeaders: Record<string, string> = { ...headers };
  if (options.authToken) {
    nextHeaders.Authorization = `Bearer ${options.authToken}`;
  }
  if (body !== undefined && !isFormDataBody(body)) {
    nextHeaders["Content-Type"] ??= "application/json";
  }
  return nextHeaders;
}

function bodyFor(body: unknown): string | FormData | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (isFormDataBody(body)) {
    return body;
  }

  return JSON.stringify(body);
}

function urlFor(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData === "function" && body instanceof FormData;
}
