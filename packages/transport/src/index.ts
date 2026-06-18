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
    this.fetchFn = options.fetchFn ?? fetch;
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

async function readError(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}
