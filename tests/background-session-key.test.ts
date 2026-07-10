import { describe, expect, it } from "vitest";
import { buildSemanticContextKey } from "../src/extension/background.js";
import { COLAB_KERNEL_SOCKET_URL, COLAB_LSP_SOCKET_URL } from "./fixtures/colab-websocket-fixtures.js";

describe("background semantic session key", () => {
  it("keeps semantic key stable across frames for same tab and notebook", () => {
    const pageUrl = "https://colab.research.google.com/drive/sanitized-notebook-id";
    const keyA = buildSemanticContextKey(COLAB_KERNEL_SOCKET_URL, pageUrl, {
      tab: { id: 7 },
      frameId: 0
    });
    const keyB = buildSemanticContextKey(COLAB_KERNEL_SOCKET_URL, pageUrl, {
      tab: { id: 7 },
      frameId: 3
    });
    expect(keyA).toBe(keyB);
  });

  it("does not merge different notebooks in the same tab", () => {
    const keyA = buildSemanticContextKey(
      COLAB_KERNEL_SOCKET_URL,
      "https://colab.research.google.com/drive/notebook-a",
      { tab: { id: 7 } }
    );
    const keyB = buildSemanticContextKey(
      COLAB_KERNEL_SOCKET_URL,
      "https://colab.research.google.com/drive/notebook-b",
      { tab: { id: 7 } }
    );
    expect(keyA).not.toBe(keyB);
  });

  it("merges context across kernel reconnections for the same notebook", () => {
    // A Colab kernel reconnect opens a new WebSocket with a different UUID in the URL.
    // Definitions stored before reconnect must remain visible after reconnect.
    const pageUrl = "https://colab.research.google.com/drive/sanitized-notebook-id";
    const kernelSocketA = "wss://runtime-sanitized.prod.colab.dev/api/kernels/uuid-a/channels";
    const kernelSocketB = "wss://runtime-sanitized.prod.colab.dev/api/kernels/uuid-b/channels";
    const keyA = buildSemanticContextKey(kernelSocketA, pageUrl, { tab: { id: 5 } });
    const keyB = buildSemanticContextKey(kernelSocketB, pageUrl, { tab: { id: 5 } });
    // Both reconnection connections must map to the same context key so that
    // definitions stored on connection A are visible when invoked on connection B.
    expect(keyA).toBe(keyB);
  });

  it("LSP socket and kernel socket produce the same context key for the same notebook", () => {
    // LSP frames arrive on a different socket URL but must share semantic context
    // with kernel channel frames for the same notebook in the same tab.
    const pageUrl = "https://colab.research.google.com/drive/sanitized-notebook-id";
    const keyKernel = buildSemanticContextKey(COLAB_KERNEL_SOCKET_URL, pageUrl, { tab: { id: 3 } });
    const keyLsp = buildSemanticContextKey(COLAB_LSP_SOCKET_URL, pageUrl, { tab: { id: 3 } });
    expect(keyKernel).toBe(keyLsp);
  });

  it("does not merge context across different browser tabs for the same notebook URL", () => {
    const pageUrl = "https://colab.research.google.com/drive/sanitized-notebook-id";
    const keyTab1 = buildSemanticContextKey(COLAB_KERNEL_SOCKET_URL, pageUrl, { tab: { id: 1 } });
    const keyTab2 = buildSemanticContextKey(COLAB_KERNEL_SOCKET_URL, pageUrl, { tab: { id: 2 } });
    expect(keyTab1).not.toBe(keyTab2);
  });
});
