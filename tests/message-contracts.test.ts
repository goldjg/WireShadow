import { describe, expect, it } from "vitest";
import {
  isPageWorldReadyMessage,
  isPageWorldObservedEventMessage,
  isPageWorldWebSocketFrameMessage,
  isPanelGetEventsMessage,
  isRuntimeContentStatusMessage,
  isRuntimeObservedEventMessage,
  isRuntimeWebSocketFrameMessage,
  toRuntimeContentStatusMessage,
  toRuntimeObservedEventMessage,
  toRuntimeWebSocketFrameMessage
} from "../src/extension/contracts.js";

describe("message contracts", () => {
  it("accepts valid page-world message and maps to runtime message", () => {
    const pageMessage = {
      source: "wireshadow-page",
      type: "wireshadow-observed-event",
      payload: {
        api: "fetch",
        url: "https://example.com/api",
        pageUrl: "https://example.com",
        timestamp: new Date().toISOString()
      }
    } as const;

    expect(isPageWorldObservedEventMessage(pageMessage)).toBe(true);
    const runtimeMessage = toRuntimeObservedEventMessage(pageMessage);
    expect(isRuntimeObservedEventMessage(runtimeMessage)).toBe(true);
  });

  it("rejects malformed message payload", () => {
    const malformed = {
      source: "wireshadow-page",
      type: "wireshadow-observed-event",
      payload: { api: "fetch" }
    };
    expect(isPageWorldObservedEventMessage(malformed)).toBe(false);
  });

  it("accepts panel query message", () => {
    expect(isPanelGetEventsMessage({ type: "wireshadow-panel-get-events" })).toBe(true);
  });

  it("accepts typed page-ready handshake", () => {
    expect(
      isPageWorldReadyMessage({
        source: "wireshadow-page",
        type: "wireshadow-page-ready",
        payload: {
          timestamp: new Date().toISOString(),
          pageUrl: "https://example.com"
        }
      })
    ).toBe(true);
  });

  it("accepts typed content status message", () => {
    const statusMessage = toRuntimeContentStatusMessage({
      pageInstrumentation: "active",
      contentBridgeReady: true,
      timestamp: new Date().toISOString(),
      pageUrl: "https://example.com"
    });
    expect(isRuntimeContentStatusMessage(statusMessage)).toBe(true);
  });

  it("accepts typed websocket frame messages", () => {
    const frameMessage = {
      source: "wireshadow-page",
      type: "wireshadow-websocket-frame",
      payload: {
        socketUrl: "wss://runtime.prod.colab.dev/api/kernels/abc/channels",
        timestamp: new Date().toISOString(),
        pageUrl: "https://colab.research.google.com/drive/abc",
        frameType: "text",
        frameByteLength: 120,
        payloadSample: "{\"header\":{\"msg_type\":\"execute_request\"}}"
      }
    } as const;

    expect(isPageWorldWebSocketFrameMessage(frameMessage)).toBe(true);
    const runtimeFrame = toRuntimeWebSocketFrameMessage(frameMessage);
    expect(isRuntimeWebSocketFrameMessage(runtimeFrame)).toBe(true);
  });
});
