"use strict";
(() => {
  // src/extension/contracts.ts
  var isObject = (value) => typeof value === "object" && value !== null;
  var isObservedPayload = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return typeof value.api === "string" && typeof value.url === "string" && typeof value.pageUrl === "string";
  };
  var isWebSocketFrameType = (value) => value === "text" || value === "arraybuffer" || value === "typed-array" || value === "blob" || value === "unknown";
  var isWebSocketFramePayload = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return typeof value.socketUrl === "string" && typeof value.timestamp === "string" && typeof value.pageUrl === "string" && isWebSocketFrameType(value.frameType) && typeof value.frameByteLength === "number" && (typeof value.payloadSample === "undefined" || typeof value.payloadSample === "string") && (typeof value.payloadSampleLength === "undefined" || typeof value.payloadSampleLength === "number") && (typeof value.payloadSampleTruncated === "undefined" || typeof value.payloadSampleTruncated === "boolean") && (typeof value.analysisFrameText === "undefined" || typeof value.analysisFrameText === "string") && (typeof value.analysisFrameTextLength === "undefined" || typeof value.analysisFrameTextLength === "number") && (typeof value.analysisEligibilityFailureReason === "undefined" || typeof value.analysisEligibilityFailureReason === "string") && (typeof value.initiatorLocation === "undefined" || typeof value.initiatorLocation === "string");
  };
  var isReadyPayload = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return typeof value.timestamp === "string" && typeof value.pageUrl === "string";
  };
  var isPageWorldObservedEventMessage = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return value.source === "wireshadow-page" && value.type === "wireshadow-observed-event" && isObservedPayload(value.payload);
  };
  var isPageWorldReadyMessage = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return value.source === "wireshadow-page" && value.type === "wireshadow-page-ready" && isReadyPayload(value.payload);
  };
  var isPageWorldWebSocketFrameMessage = (value) => {
    if (!isObject(value)) {
      return false;
    }
    return value.source === "wireshadow-page" && value.type === "wireshadow-websocket-frame" && isWebSocketFramePayload(value.payload);
  };
  var toRuntimeObservedEventMessage = (message) => ({
    type: "wireshadow-observed-event",
    payload: message.payload
  });
  var toRuntimeWebSocketFrameMessage = (message) => ({
    type: "wireshadow-websocket-frame",
    payload: message.payload
  });
  var toRuntimeContentStatusMessage = (payload) => ({
    type: "wireshadow-content-status",
    payload
  });

  // src/extension/content-script.ts
  var getChromeRuntime = () => globalThis.chrome?.runtime;
  var extensionContextInvalidated = false;
  var messageListenerCleanup;
  var safeSendMessage = (message) => {
    if (extensionContextInvalidated) return;
    try {
      getChromeRuntime()?.sendMessage?.(message);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Extension context invalidated")) {
        extensionContextInvalidated = true;
        messageListenerCleanup?.();
        return;
      }
      throw error;
    }
  };
  var PAGE_WORLD_MARKER = "data-wireshadow-page-world";
  var PAGE_WORLD_SCRIPT_ID = "wireshadow-page-world-script";
  var CONTENT_BRIDGE_READY = "__wireshadow_content_bridge_ready";
  var sendContentStatus = (payload) => {
    safeSendMessage(toRuntimeContentStatusMessage(payload));
  };
  var injectPageWorldScript = () => {
    const runtime = getChromeRuntime();
    const root = document.documentElement;
    const scriptUrl = runtime?.getURL?.("page-world.js");
    if (!root || !scriptUrl) {
      sendContentStatus({
        pageInstrumentation: "failed",
        contentBridgeReady: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pageUrl: window.location.href,
        reason: "runtime-unavailable"
      });
      return;
    }
    const existingState = root.getAttribute(PAGE_WORLD_MARKER);
    if (existingState === "pending" || existingState === "active" || existingState === "failed") {
      return;
    }
    if (document.getElementById(PAGE_WORLD_SCRIPT_ID)) {
      root.setAttribute(PAGE_WORLD_MARKER, "pending");
      return;
    }
    root.setAttribute(PAGE_WORLD_MARKER, "pending");
    console.info("[WireShadow] page-world script requested");
    const script = document.createElement("script");
    script.id = PAGE_WORLD_SCRIPT_ID;
    script.src = scriptUrl;
    script.dataset.wireshadow = "true";
    const finalize = (state, reason) => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      script.remove();
      root.setAttribute(PAGE_WORLD_MARKER, state);
      sendContentStatus({
        pageInstrumentation: state,
        contentBridgeReady: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        pageUrl: window.location.href,
        reason
      });
    };
    const onLoad = () => {
      finalize("unknown");
    };
    const onError = () => {
      finalize("failed", "page-world-load-error");
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    (document.head ?? root).appendChild(script);
  };
  var forwardMetadata = () => {
    const marker = window;
    if (marker[CONTENT_BRIDGE_READY]) {
      return;
    }
    marker[CONTENT_BRIDGE_READY] = true;
    console.info("[WireShadow] content bridge ready");
    sendContentStatus({
      pageInstrumentation: "unknown",
      contentBridgeReady: true,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pageUrl: window.location.href
    });
    const onMessage = (event) => {
      if (event.source !== window) {
        return;
      }
      if (isPageWorldReadyMessage(event.data)) {
        document.documentElement?.setAttribute(PAGE_WORLD_MARKER, "active");
        sendContentStatus({
          pageInstrumentation: "active",
          contentBridgeReady: true,
          timestamp: event.data.payload.timestamp,
          pageUrl: event.data.payload.pageUrl
        });
        return;
      }
      if (!isPageWorldObservedEventMessage(event.data)) {
        if (!isPageWorldWebSocketFrameMessage(event.data)) {
          return;
        }
        console.info("[WireShadow] observed event forwarded");
        safeSendMessage(toRuntimeWebSocketFrameMessage(event.data));
        return;
      }
      console.info("[WireShadow] observed event forwarded");
      safeSendMessage(toRuntimeObservedEventMessage(event.data));
    };
    window.addEventListener("message", onMessage);
    messageListenerCleanup = () => window.removeEventListener("message", onMessage);
  };
  forwardMetadata();
  injectPageWorldScript();
})();
