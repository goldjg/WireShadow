import { describe, expect, it, vi } from "vitest";

describe("instrumentation helpers", () => {
  it("summarizes fetch-style payloads", async () => {
    vi.stubGlobal("window", { location: { href: "https://example.com" } });
    vi.stubGlobal("document", {});
    const { summarizeBodyForObservation } = await import("../src/extension/page-world.js");

    const summary = summarizeBodyForObservation("token=abc123&email=analyst@company.example");
    expect(summary.bodyLength).toBeGreaterThan(0);
    expect(summary.payloadSample).toContain("email=");
  });

  it("creates observed message with page context", async () => {
    vi.stubGlobal("window", { location: { href: "https://example.com/path" } });
    vi.stubGlobal("document", {});
    const { createObservedMessage } = await import("../src/extension/page-world.js");

    const message = createObservedMessage("fetch", "https://api.example.com/data", {
      method: "POST",
      bodyLength: 12
    });
    expect(message.type).toBe("wireshadow-observed-event");
    expect(message.payload.pageUrl).toBe("https://example.com/path");
    expect(message.payload.bodyLength).toBe(12);
  });

  it("creates XHR observation metadata", async () => {
    vi.stubGlobal("window", { location: { href: "https://example.com/path" } });
    vi.stubGlobal("document", {});
    const { createObservedMessage } = await import("../src/extension/page-world.js");

    const message = createObservedMessage("xhr", "https://api.example.com/xhr", {
      method: "PUT",
      bodyLength: 9
    });
    expect(message.payload.api).toBe("xhr");
    expect(message.payload.method).toBe("PUT");
    expect(message.payload.bodyLength).toBe(9);
  });
});
