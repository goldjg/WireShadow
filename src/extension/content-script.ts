import {
  isPageWorldObservedEventMessage,
  isPageWorldReadyMessage,
  isPageWorldWebSocketFrameMessage,
  toRuntimeContentStatusMessage,
  toRuntimeObservedEventMessage,
  toRuntimeWebSocketFrameMessage
} from "./contracts.js";
import type {
  RuntimeContentStatusMessage,
  RuntimeObservedEventMessage,
  RuntimeWebSocketFrameMessage
} from "../core/types.js";

interface ChromeLikeRuntime {
  sendMessage?: (
    message: RuntimeObservedEventMessage | RuntimeWebSocketFrameMessage | RuntimeContentStatusMessage
  ) => void;
  getURL?: (path: string) => string;
}

interface ChromeLike {
  runtime?: ChromeLikeRuntime;
}

const getChromeRuntime = (): ChromeLikeRuntime | undefined =>
  (globalThis as { chrome?: ChromeLike }).chrome?.runtime;

const PAGE_WORLD_MARKER = "data-wireshadow-page-world";
const PAGE_WORLD_SCRIPT_ID = "wireshadow-page-world-script";
const CONTENT_BRIDGE_READY = "__wireshadow_content_bridge_ready";

const sendContentStatus = (payload: RuntimeContentStatusMessage["payload"]): void => {
  const runtime = getChromeRuntime();
  runtime?.sendMessage?.(toRuntimeContentStatusMessage(payload));
};

const injectPageWorldScript = (): void => {
  const runtime = getChromeRuntime();
  const root = document.documentElement;
  const scriptUrl = runtime?.getURL?.("page-world.js");
  if (!root || !scriptUrl) {
    sendContentStatus({
      pageInstrumentation: "failed",
      contentBridgeReady: true,
      timestamp: new Date().toISOString(),
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

  const finalize = (state: "failed" | "unknown", reason?: string): void => {
    script.removeEventListener("load", onLoad);
    script.removeEventListener("error", onError);
    script.remove();
    root.setAttribute(PAGE_WORLD_MARKER, state);
    sendContentStatus({
      pageInstrumentation: state,
      contentBridgeReady: true,
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      reason
    });
  };

  const onLoad = (): void => {
    finalize("unknown");
  };

  const onError = (): void => {
    finalize("failed", "page-world-load-error");
  };

  script.addEventListener("load", onLoad, { once: true });
  script.addEventListener("error", onError, { once: true });
  (document.head ?? root).appendChild(script);
};

const forwardMetadata = (): void => {
  const marker = window as Window & { [CONTENT_BRIDGE_READY]?: boolean };
  if (marker[CONTENT_BRIDGE_READY]) {
    return;
  }
  marker[CONTENT_BRIDGE_READY] = true;
  console.info("[WireShadow] content bridge ready");
  sendContentStatus({
    pageInstrumentation: "unknown",
    contentBridgeReady: true,
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href
  });

  window.addEventListener("message", (event: MessageEvent) => {
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
      const runtime = getChromeRuntime();
      console.info("[WireShadow] observed event forwarded");
      runtime?.sendMessage?.(toRuntimeWebSocketFrameMessage(event.data));
      return;
    }

    const runtime = getChromeRuntime();
    console.info("[WireShadow] observed event forwarded");
    runtime?.sendMessage?.(toRuntimeObservedEventMessage(event.data));
  });
};

forwardMetadata();
injectPageWorldScript();
