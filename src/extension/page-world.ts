import type { InitiatingApi, PageWorldObservedEventMessage } from "../core/types.js";

const MAX_SAMPLE_LEN = 2048;
const XHR_META = Symbol("wireshadow-xhr-meta");
const WIRESHADOW_PATCHED = "__wireshadow_patched";

interface XhrMeta {
  method: string;
  url: string;
}

interface PayloadSummary {
  bodyLength?: number;
  payloadSample?: string;
}

const truncate = (value: string): string =>
  value.length <= MAX_SAMPLE_LEN ? value : value.slice(0, MAX_SAMPLE_LEN);

export const extractInitiatorLocation = (): string | undefined => {
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }
  const line = stack
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("at ") && !entry.includes("page-world"));
  return line;
};

const serializeFormData = (formData: FormData): string => {
  const pairs: string[] = [];
  for (const [key, value] of formData.entries()) {
    pairs.push(`${key}=${typeof value === "string" ? value : value.name}`);
  }
  return pairs.join("&");
};

export const summarizeBodyForObservation = (data: unknown): PayloadSummary => {
  if (typeof data === "undefined" || data === null) {
    return {};
  }

  if (typeof data === "string") {
    return { bodyLength: data.length, payloadSample: truncate(data) };
  }

  if (data instanceof URLSearchParams) {
    const encoded = data.toString();
    return { bodyLength: encoded.length, payloadSample: truncate(encoded) };
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { bodyLength: data.size };
  }

  if (data instanceof FormData) {
    const serialised = serializeFormData(data);
    return { bodyLength: serialised.length, payloadSample: truncate(serialised) };
  }

  if (data instanceof ArrayBuffer) {
    return { bodyLength: data.byteLength };
  }

  if (ArrayBuffer.isView(data)) {
    return { bodyLength: data.byteLength };
  }

  try {
    const serialised = JSON.stringify(data);
    return { bodyLength: serialised.length, payloadSample: truncate(serialised) };
  } catch {
    return {};
  }
};

export const createObservedMessage = (
  api: InitiatingApi,
  url: string,
  options: {
    method?: string;
    bodyLength?: number;
    payloadSample?: string;
    initiatorLocation?: string;
  } = {}
): PageWorldObservedEventMessage => ({
  source: "wireshadow-page",
  type: "wireshadow-observed-event",
  payload: {
    api,
    url,
    method: options.method,
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    initiatorLocation: options.initiatorLocation,
    bodyLength: options.bodyLength,
    payloadSample: options.payloadSample
  }
});

const emit = (message: PageWorldObservedEventMessage): void => {
  window.postMessage(message, window.location.origin);
};

const installFetchProbe = (): void => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const body = summarizeBodyForObservation(init?.body);
    emit(
      createObservedMessage("fetch", url, {
        method: init?.method ?? "GET",
        bodyLength: body.bodyLength,
        payloadSample: body.payloadSample,
        initiatorLocation: extractInitiatorLocation()
      })
    );
    return nativeFetch(input, init);
  };
};

const installXhrProbe = (): void => {
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    ...args: unknown[]
  ): void {
    (this as XMLHttpRequest & { [XHR_META]?: XhrMeta })[XHR_META] = {
      method,
      url: url.toString()
    };
    const [async = true, user, password] = args as [boolean?, string?, string?];
    nativeOpen.call(this, method, url.toString(), async, user, password);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null): void {
    const meta = (this as XMLHttpRequest & { [XHR_META]?: XhrMeta })[XHR_META];
    if (meta) {
      const summary = summarizeBodyForObservation(body);
      emit(
        createObservedMessage("xhr", meta.url, {
          method: meta.method,
          bodyLength: summary.bodyLength,
          payloadSample: summary.payloadSample,
          initiatorLocation: extractInitiatorLocation()
        })
      );
    }
    nativeSend.call(this, body);
  };
};

const installSendBeaconProbe = (): void => {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return;
  }
  const nativeSendBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
    const summary = summarizeBodyForObservation(data);
    emit(
      createObservedMessage("sendBeacon", url.toString(), {
        method: "POST",
        bodyLength: summary.bodyLength,
        payloadSample: summary.payloadSample,
        initiatorLocation: extractInitiatorLocation()
      })
    );
    return nativeSendBeacon(url, data);
  };
};

const installWebSocketProbe = (): void => {
  if (typeof window.WebSocket === "undefined") {
    return;
  }
  const NativeWebSocket = window.WebSocket;
  class WireShadowWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      emit(
        createObservedMessage("websocket", url.toString(), {
          initiatorLocation: extractInitiatorLocation()
        })
      );
      super(url, protocols);
    }
  }
  window.WebSocket = WireShadowWebSocket;
};

const installEventSourceProbe = (): void => {
  if (typeof window.EventSource === "undefined") {
    return;
  }
  const NativeEventSource = window.EventSource;
  class WireShadowEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      emit(
        createObservedMessage("eventsource", url.toString(), {
          method: "GET",
          initiatorLocation: extractInitiatorLocation()
        })
      );
      super(url, eventSourceInitDict);
    }
  }
  window.EventSource = WireShadowEventSource;
};

export const installPageWorldProbes = (): void => {
  const marker = window as Window & { [WIRESHADOW_PATCHED]?: boolean };
  if (marker[WIRESHADOW_PATCHED]) {
    return;
  }
  if (typeof window.fetch !== "function" || typeof XMLHttpRequest === "undefined") {
    return;
  }
  marker[WIRESHADOW_PATCHED] = true;
  installFetchProbe();
  installXhrProbe();
  installSendBeaconProbe();
  installWebSocketProbe();
  installEventSourceProbe();
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installPageWorldProbes();
}
