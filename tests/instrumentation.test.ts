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

  it("emits typed page-ready handshake after probe install", async () => {
    const postMessage = vi.fn();
    class FakeXMLHttpRequest {
      open(): void {}
      send(): void {}
    }

    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("window", {
      location: { href: "https://example.com/path", origin: "https://example.com" },
      fetch: vi.fn(),
      postMessage,
      navigator: {}
    });
    vi.stubGlobal("document", {});

    const { installPageWorldProbes } = await import("../src/extension/page-world.js");
    expect(installPageWorldProbes()).toBe(true);
    expect(
      postMessage.mock.calls.some(
        ([message]) => message && typeof message === "object" && message.type === "wireshadow-page-ready"
      )
    ).toBe(true);
  });

  it("emits websocket outbound-frame observations for text and binary sends", async () => {
    const postMessage = vi.fn();
    class FakeXMLHttpRequest {
      open(): void {}
      send(): void {}
    }
    class FakeWebSocket {
      url: string;
      constructor(url: string | URL) {
        this.url = url.toString();
      }
      send(_data: unknown): void {}
    }

    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("window", {
      location: { href: "https://colab.research.google.com/drive/sanitized", origin: "https://colab.research.google.com" },
      fetch: vi.fn(),
      postMessage,
      navigator: {},
      WebSocket: FakeWebSocket
    });
    vi.stubGlobal("document", {});

    const { installPageWorldProbes } = await import("../src/extension/page-world.js");
    expect(installPageWorldProbes()).toBe(true);

    const socket = new (window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket(
      "wss://runtime-sanitized.prod.colab.dev/api/kernels/sanitized-kernel/channels"
    );
    socket.send('{"header":{"msg_type":"execute_request"}}');
    socket.send(new Uint8Array([1, 2, 3, 4]));

    const frameMessages = postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message && typeof message === "object" && message.type === "wireshadow-websocket-frame");

    expect(frameMessages).toHaveLength(2);
    expect(frameMessages[0].payload.frameType).toBe("text");
    expect(frameMessages[1].payload.frameType).toBe("typed-array");
  });

  it("keeps full analysis frame text while truncating display sample", async () => {
    const postMessage = vi.fn();
    class FakeXMLHttpRequest {
      open(): void {}
      send(): void {}
    }
    class FakeWebSocket {
      url: string;
      constructor(url: string | URL) {
        this.url = url.toString();
      }
      send(_data: unknown): void {}
    }

    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("window", {
      location: { href: "https://colab.research.google.com/drive/sanitized", origin: "https://colab.research.google.com" },
      fetch: vi.fn(),
      postMessage,
      navigator: {},
      WebSocket: FakeWebSocket
    });
    vi.stubGlobal("document", {});

    const { installPageWorldProbes } = await import("../src/extension/page-world.js");
    expect(installPageWorldProbes()).toBe(true);

    const largeCode = `{"header":{"msg_type":"execute_request"},"content":{"code":"${"A".repeat(7000)}"}}`;
    const socket = new (window as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket(
      "wss://runtime-sanitized.prod.colab.dev/api/kernels/sanitized-kernel/channels"
    );
    socket.send(largeCode);

    const frameMessage = postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message && typeof message === "object" && message.type === "wireshadow-websocket-frame");

    expect(frameMessage).toBeDefined();
    expect(frameMessage.payload.payloadSampleTruncated).toBe(true);
    expect(frameMessage.payload.payloadSampleLength).toBeLessThan(frameMessage.payload.analysisFrameTextLength);
    expect(frameMessage.payload.analysisFrameTextLength).toBe(largeCode.length);
  });
});
