import type {
  ExtensionInboundMessage,
  PageWorldObservedEventMessage,
  PanelGetEventsMessage,
  RuntimeObservedEventMessage
} from "../core/types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isObservedPayload = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.api === "string" && typeof value.url === "string" && typeof value.pageUrl === "string";
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

export const isRuntimeObservedEventMessage = (
  value: unknown
): value is RuntimeObservedEventMessage => {
  if (!isObject(value)) {
    return false;
  }
  return value.type === "wireshadow-observed-event" && isObservedPayload(value.payload);
};

export const isPanelGetEventsMessage = (value: unknown): value is PanelGetEventsMessage =>
  isObject(value) && value.type === "wireshadow-panel-get-events";

export const toRuntimeObservedEventMessage = (
  message: PageWorldObservedEventMessage
): RuntimeObservedEventMessage => ({
  type: "wireshadow-observed-event",
  payload: message.payload
});

export const isExtensionInboundMessage = (value: unknown): value is ExtensionInboundMessage =>
  isRuntimeObservedEventMessage(value) || isPanelGetEventsMessage(value);
