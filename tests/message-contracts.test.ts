import { describe, expect, it } from "vitest";
import {
  isPageWorldObservedEventMessage,
  isPanelGetEventsMessage,
  isRuntimeObservedEventMessage,
  toRuntimeObservedEventMessage
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
});
