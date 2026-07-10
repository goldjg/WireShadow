import type {
  ExtensionInboundMessage,
  InstrumentationState,
  PageWorldReadyMessage,
  PageWorldObservedEventMessage,
  PageWorldWebSocketFrameMessage,
  PanelGetEventsMessage,
  RuntimeContentStatusMessage,
  RuntimeObservedEventMessage,
  RuntimeWebSocketFrameMessage
} from "../core/types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isObservedPayload = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.api === "string" && typeof value.url === "string" && typeof value.pageUrl === "string";
};

const isWebSocketFrameType = (value: unknown): boolean =>
  value === "text" || value === "arraybuffer" || value === "typed-array" || value === "blob" || value === "unknown";

const isWebSocketFramePayload = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.socketUrl === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.pageUrl === "string" &&
    isWebSocketFrameType(value.frameType) &&
    typeof value.frameByteLength === "number" &&
    (typeof value.payloadSample === "undefined" || typeof value.payloadSample === "string") &&
    (typeof value.payloadSampleLength === "undefined" || typeof value.payloadSampleLength === "number") &&
    (typeof value.payloadSampleTruncated === "undefined" || typeof value.payloadSampleTruncated === "boolean") &&
    (typeof value.analysisFrameText === "undefined" || typeof value.analysisFrameText === "string") &&
    (typeof value.analysisFrameTextLength === "undefined" || typeof value.analysisFrameTextLength === "number") &&
    (typeof value.analysisEligibilityFailureReason === "undefined" ||
      typeof value.analysisEligibilityFailureReason === "string") &&
    (typeof value.initiatorLocation === "undefined" || typeof value.initiatorLocation === "string")
  );
};

const isInstrumentationState = (value: unknown): value is InstrumentationState =>
  value === "active" || value === "failed" || value === "unknown";

const isReadyPayload = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.timestamp === "string" && typeof value.pageUrl === "string";
};

const isContentStatusPayload = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  return (
    isInstrumentationState(value.pageInstrumentation) &&
    typeof value.contentBridgeReady === "boolean" &&
    typeof value.timestamp === "string" &&
    (typeof value.pageUrl === "undefined" || typeof value.pageUrl === "string") &&
    (typeof value.reason === "undefined" || typeof value.reason === "string")
  );
};

export const isPageWorldObservedEventMessage = (
  value: unknown
): value is PageWorldObservedEventMessage => {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.source === "wireshadow-page" &&
    value.type === "wireshadow-observed-event" &&
    isObservedPayload(value.payload)
  );
};

export const isPageWorldReadyMessage = (value: unknown): value is PageWorldReadyMessage => {
  if (!isObject(value)) {
    return false;
  }
  return value.source === "wireshadow-page" && value.type === "wireshadow-page-ready" && isReadyPayload(value.payload);
};

export const isPageWorldWebSocketFrameMessage = (
  value: unknown
): value is PageWorldWebSocketFrameMessage => {
  if (!isObject(value)) {
    return false;
  }
  return (
    value.source === "wireshadow-page" &&
    value.type === "wireshadow-websocket-frame" &&
    isWebSocketFramePayload(value.payload)
  );
};

export const isRuntimeObservedEventMessage = (
  value: unknown
): value is RuntimeObservedEventMessage => {
  if (!isObject(value)) {
    return false;
  }
  return value.type === "wireshadow-observed-event" && isObservedPayload(value.payload);
};

export const isRuntimeWebSocketFrameMessage = (
  value: unknown
): value is RuntimeWebSocketFrameMessage =>
  isObject(value) && value.type === "wireshadow-websocket-frame" && isWebSocketFramePayload(value.payload);

export const isRuntimeContentStatusMessage = (
  value: unknown
): value is RuntimeContentStatusMessage =>
  isObject(value) && value.type === "wireshadow-content-status" && isContentStatusPayload(value.payload);

export const isPanelGetEventsMessage = (value: unknown): value is PanelGetEventsMessage =>
  isObject(value) && value.type === "wireshadow-panel-get-events";

export const toRuntimeObservedEventMessage = (
  message: PageWorldObservedEventMessage
): RuntimeObservedEventMessage => ({
  type: "wireshadow-observed-event",
  payload: message.payload
});

export const toRuntimeWebSocketFrameMessage = (
  message: PageWorldWebSocketFrameMessage
): RuntimeWebSocketFrameMessage => ({
  type: "wireshadow-websocket-frame",
  payload: message.payload
});

export const toRuntimeContentStatusMessage = (
  payload: RuntimeContentStatusMessage["payload"]
): RuntimeContentStatusMessage => ({
  type: "wireshadow-content-status",
  payload
});

export const isExtensionInboundMessage = (value: unknown): value is ExtensionInboundMessage =>
  isRuntimeObservedEventMessage(value) ||
  isRuntimeWebSocketFrameMessage(value) ||
  isRuntimeContentStatusMessage(value) ||
  isPanelGetEventsMessage(value);
