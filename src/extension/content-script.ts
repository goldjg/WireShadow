import { isPageWorldObservedEventMessage, toRuntimeObservedEventMessage } from "./contracts.js";
import type { RuntimeObservedEventMessage } from "../core/types.js";

interface ChromeLikeRuntime {
  sendMessage?: (message: RuntimeObservedEventMessage) => void;
  getURL?: (path: string) => string;
}

interface ChromeLike {
  runtime?: ChromeLikeRuntime;
}

const getChromeRuntime = (): ChromeLikeRuntime | undefined =>
  (globalThis as { chrome?: ChromeLike }).chrome?.runtime;

const injectPageWorldScript = (): void => {
  const runtime = getChromeRuntime();
  const scriptUrl = runtime?.getURL?.("page-world.js");
  if (!scriptUrl) {
    return;
  }
  const script = document.createElement("script");
  script.src = scriptUrl;
  script.dataset.wireshadow = "true";
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
};

const forwardMetadata = (): void => {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }
    if (!isPageWorldObservedEventMessage(event.data)) {
      return;
    }

    const runtime = getChromeRuntime();
    runtime?.sendMessage?.(toRuntimeObservedEventMessage(event.data));
  });
};

injectPageWorldScript();
forwardMetadata();
