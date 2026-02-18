import type { WsPush, WsRequest, WsResponse } from "@t3tools/contracts";

type PushListener = (data: unknown) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const RUNTIME_WS_URL_PARAM = "t3WsUrl";
const RUNTIME_WS_TOKEN_PARAM = "t3Token";

function trimToUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRuntimeParam(name: string): string | undefined {
  const fromSearch = trimToUndefined(new URLSearchParams(window.location.search).get(name));
  if (fromSearch) return fromSearch;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return trimToUndefined(new URLSearchParams(hash).get(name));
}

function normalizeWsUrl(raw: string): string {
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.protocol === "http:") parsed.protocol = "ws:";
    if (parsed.protocol === "https:") parsed.protocol = "wss:";
    return parsed.toString();
  } catch {
    return raw;
  }
}

function withAuthToken(url: string, token: string | undefined): string {
  if (!token) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (!parsed.searchParams.get("token")) {
      parsed.searchParams.set("token", token);
    }
    return parsed.toString();
  } catch {
    const glue = url.includes("?") ? "&" : "?";
    return `${url}${glue}token=${encodeURIComponent(token)}`;
  }
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<PushListener>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly url: string;

  constructor(url?: string) {
    const bridgeUrl = window.desktopBridge?.getWsUrl();
    const runtimeWsUrl = readRuntimeParam(RUNTIME_WS_URL_PARAM);
    const runtimeWsToken = readRuntimeParam(RUNTIME_WS_TOKEN_PARAM);
    // In dev mode, VITE_WS_URL points to the server's WebSocket endpoint.
    // In production, the page is served by the WS server on the same host:port.
    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    const envToken = trimToUndefined(import.meta.env.VITE_WS_TOKEN as string | undefined);
    const defaultProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const defaultUrl = `${defaultProtocol}://${window.location.host}`;
    const selectedUrl = trimToUndefined(
      url ?? bridgeUrl ?? runtimeWsUrl ?? trimToUndefined(envUrl) ?? defaultUrl,
    );
    this.url = withAuthToken(normalizeWsUrl(selectedUrl ?? defaultUrl), runtimeWsToken ?? envToken);
    this.connect();
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = String(this.nextId++);
    const message: WsRequest = { id, method, ...(params !== undefined ? { params } : {}) };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(message);
    });
  }

  subscribe(channel: string, listener: PushListener): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
    }
    channelListeners.add(listener);

    return () => {
      channelListeners!.delete(listener);
      if (channelListeners!.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }

  private connect() {
    if (this.disposed) return;

    const ws = new WebSocket(this.url);

    ws.addEventListener("open", () => {
      this.ws = ws;
      this.reconnectAttempt = 0;
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event will fire after error
    });
  }

  private handleMessage(raw: unknown) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    const message = parsed as Record<string, unknown>;

    // Push event
    if (message.type === "push") {
      const push = message as unknown as WsPush;
      const channelListeners = this.listeners.get(push.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(push.data);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    // Response to a request
    if (typeof message.id === "string") {
      const response = message as unknown as WsResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private send(message: WsRequest) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return;
    }

    // If not connected, wait for connection
    const waitForOpen = () => {
      const check = setInterval(() => {
        if (this.disposed) {
          clearInterval(check);
          return;
        }
        if (this.ws?.readyState === WebSocket.OPEN) {
          clearInterval(check);
          this.ws.send(JSON.stringify(message));
        }
      }, 50);

      // Give up after timeout (the pending request will time out on its own)
      setTimeout(() => clearInterval(check), REQUEST_TIMEOUT_MS);
    };
    waitForOpen();
  }

  private scheduleReconnect() {
    if (this.disposed) return;

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[0]!;

    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
