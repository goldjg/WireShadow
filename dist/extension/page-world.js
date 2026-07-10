"use strict";
(() => {
  // src/extension/page-world.ts
  var MAX_SAMPLE_LEN = 2048;
  var MAX_ANALYSIS_FRAME_BYTES = 256 * 1024;
  var XHR_META = /* @__PURE__ */ Symbol("wireshadow-xhr-meta");
  var WIRESHADOW_PATCHED = "__wireshadow_patched";
  var truncate = (value) => value.length <= MAX_SAMPLE_LEN ? value : value.slice(0, MAX_SAMPLE_LEN);
  var extractInitiatorLocation = () => {
    const stack = new Error().stack;
    if (!stack) {
      return void 0;
    }
    const line = stack.split("\n").map((entry) => entry.trim()).find((entry) => entry.startsWith("at ") && !entry.includes("page-world"));
    return line;
  };
  var serializeFormData = (formData) => {
    const pairs = [];
    for (const [key, value] of formData.entries()) {
      pairs.push(`${key}=${typeof value === "string" ? value : value.name}`);
    }
    return pairs.join("&");
  };
  var summarizeBodyForObservation = (data) => {
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
  var createObservedMessage = (api, url, options = {}) => ({
    source: "wireshadow-page",
    type: "wireshadow-observed-event",
    payload: {
      api,
      url,
      method: options.method,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pageUrl: window.location.href,
      initiatorLocation: options.initiatorLocation,
      bodyLength: options.bodyLength,
      payloadSample: options.payloadSample
    }
  });
  var emit = (message) => {
    window.postMessage(message, window.location.origin);
  };
  var emitWebSocketFrame = (message) => {
    window.postMessage(message, window.location.origin);
  };
  var createReadyMessage = () => ({
    source: "wireshadow-page",
    type: "wireshadow-page-ready",
    payload: {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pageUrl: window.location.href
    }
  });
  var emitReady = () => {
    window.postMessage(createReadyMessage(), window.location.origin);
  };
  var isMostlyPrintableText = (value) => {
    if (value.length === 0) {
      return false;
    }
    const nonPrintable = Array.from(value).filter((char) => {
      const code = char.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    return nonPrintable / value.length < 0.05;
  };
  var summarizeBinarySample = (bytes) => {
    if (bytes.byteLength === 0) {
      return void 0;
    }
    const decoder = new TextDecoder();
    const text = decoder.decode(bytes.subarray(0, MAX_SAMPLE_LEN));
    return isMostlyPrintableText(text) ? truncate(text) : void 0;
  };
  var buildAnalysisFrameText = (text, frameByteLength) => {
    if (frameByteLength > MAX_ANALYSIS_FRAME_BYTES) {
      return { analysisEligibilityFailureReason: "frame-too-large" };
    }
    return {
      analysisFrameText: text,
      analysisFrameTextLength: text.length
    };
  };
  var summarizeWebSocketFrame = (data) => {
    if (typeof data === "string") {
      const encoder = new TextEncoder();
      const byteLength = encoder.encode(data).byteLength;
      const sample = truncate(data);
      return {
        frameType: "text",
        frameByteLength: byteLength,
        payloadSample: sample,
        payloadSampleLength: sample.length,
        payloadSampleTruncated: sample.length < data.length,
        ...buildAnalysisFrameText(data, byteLength)
      };
    }
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      const sample = summarizeBinarySample(bytes);
      const decoded = bytes.byteLength <= MAX_ANALYSIS_FRAME_BYTES ? new TextDecoder("utf-8", { fatal: false }).decode(bytes) : void 0;
      return {
        frameType: "arraybuffer",
        frameByteLength: bytes.byteLength,
        payloadSample: sample,
        payloadSampleLength: sample?.length,
        payloadSampleTruncated: bytes.byteLength > MAX_SAMPLE_LEN,
        ...decoded ? buildAnalysisFrameText(decoded, bytes.byteLength) : { analysisEligibilityFailureReason: "frame-too-large" }
      };
    }
    if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const sample = summarizeBinarySample(bytes);
      const decoded = bytes.byteLength <= MAX_ANALYSIS_FRAME_BYTES ? new TextDecoder("utf-8", { fatal: false }).decode(bytes) : void 0;
      return {
        frameType: "typed-array",
        frameByteLength: bytes.byteLength,
        payloadSample: sample,
        payloadSampleLength: sample?.length,
        payloadSampleTruncated: bytes.byteLength > MAX_SAMPLE_LEN,
        ...decoded ? buildAnalysisFrameText(decoded, bytes.byteLength) : { analysisEligibilityFailureReason: "frame-too-large" }
      };
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return {
        frameType: "blob",
        frameByteLength: data.size,
        payloadSampleTruncated: false,
        analysisEligibilityFailureReason: "unsupported-envelope"
      };
    }
    return {
      frameType: "unknown",
      frameByteLength: 0,
      payloadSampleTruncated: false,
      analysisEligibilityFailureReason: "unknown"
    };
  };
  var createWebSocketFrameMessage = (socketUrl, summary) => ({
    source: "wireshadow-page",
    type: "wireshadow-websocket-frame",
    payload: {
      socketUrl,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pageUrl: window.location.href,
      frameType: summary.frameType,
      frameByteLength: summary.frameByteLength,
      payloadSample: summary.payloadSample,
      payloadSampleLength: summary.payloadSampleLength,
      payloadSampleTruncated: summary.payloadSampleTruncated,
      analysisFrameText: summary.analysisFrameText,
      analysisFrameTextLength: summary.analysisFrameTextLength,
      analysisEligibilityFailureReason: summary.analysisEligibilityFailureReason,
      initiatorLocation: extractInitiatorLocation()
    }
  });
  var installFetchProbe = () => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
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
  var installXhrProbe = () => {
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...args) {
      this[XHR_META] = {
        method,
        url: url.toString()
      };
      const [async = true, user, password] = args;
      nativeOpen.call(this, method, url.toString(), async, user, password);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const meta = this[XHR_META];
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
  var installSendBeaconProbe = () => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return;
    }
    const nativeSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
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
  var installWebSocketProbe = () => {
    if (typeof window.WebSocket === "undefined") {
      return;
    }
    const NativeWebSocket = window.WebSocket;
    class WireShadowWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        emit(
          createObservedMessage("websocket", url.toString(), {
            initiatorLocation: extractInitiatorLocation()
          })
        );
        super(url, protocols);
      }
      send(data) {
        const summary = summarizeWebSocketFrame(data);
        emitWebSocketFrame(createWebSocketFrameMessage(this.url, summary));
        super.send(data);
      }
    }
    window.WebSocket = WireShadowWebSocket;
  };
  var installEventSourceProbe = () => {
    if (typeof window.EventSource === "undefined") {
      return;
    }
    const NativeEventSource = window.EventSource;
    class WireShadowEventSource extends NativeEventSource {
      constructor(url, eventSourceInitDict) {
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
  var installPageWorldProbes = () => {
    const marker = window;
    if (marker[WIRESHADOW_PATCHED]) {
      return true;
    }
    if (typeof window.fetch !== "function" || typeof XMLHttpRequest === "undefined") {
      return false;
    }
    marker[WIRESHADOW_PATCHED] = true;
    installFetchProbe();
    installXhrProbe();
    installSendBeaconProbe();
    installWebSocketProbe();
    installEventSourceProbe();
    console.info("[WireShadow] page-world probes installed");
    emitReady();
    return true;
  };
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    installPageWorldProbes();
  }
})();
