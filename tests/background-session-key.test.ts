import { describe, expect, it } from "vitest";
import { buildSemanticContextKey } from "../src/extension/background.js";
import { COLAB_KERNEL_SOCKET_URL } from "./fixtures/colab-websocket-fixtures.js";

describe("background semantic session key", () => {
  it("keeps semantic key stable across frames for same tab/kernel/notebook", () => {
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
});
