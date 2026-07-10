import { describe, expect, it } from "vitest";
import { isColabUrl, recogniseColabWebSocketFrame, recogniseColabSignals } from "../src/recognisers/colab.js";
import {
  COLAB_KERNEL_SOCKET_URL,
  COLAB_LSP_SOCKET_URL,
  JUPYTER_EXECUTE_REQUEST_ARRAY_WRAPPED,
  JUPYTER_EXECUTE_REQUEST_EMPTY_CODE,
  JUPYTER_EXECUTE_REQUEST_NESTED,
  JUPYTER_EXECUTE_REQUEST_PREFIXED,
  JUPYTER_EXECUTE_REQUEST_STRINGIFIED_NESTED,
  JUPYTER_EXECUTE_REQUEST_WITH_CODE,
  LARGE_JUPYTER_EXECUTE_REQUEST_WITH_CODE,
  JUPYTER_STATUS_MESSAGE,
  LSP_DID_OPEN_MESSAGE,
  MALFORMED_JSON_FRAME,
  ORDINARY_COLAB_XHR_PAYLOAD
} from "./fixtures/colab-websocket-fixtures.js";

describe("colab recogniser", () => {
  it("identifies Google Colab URLs", () => {
    expect(isColabUrl("https://colab.research.google.com/drive/abc")).toBe(true);
    expect(isColabUrl("https://example.com/not-colab")).toBe(false);
  });

  it("identifies notebook and delegated execution semantics", () => {
    const content = `
{
  "metadata": {"kernelspec": {"name": "python3"}},
  "cells": [
    {"cell_type": "markdown", "source": ["# test"]},
    {"cell_type": "code", "source": ["import requests", "requests.post(\\"https://api.github.com/repos/org/repo/issues\\")"]},
    {"cell_type": "code", "source": ["run all"]}
  ]
}
`;
    const result = recogniseColabSignals(
      "https://colab.research.google.com/drive/abc",
      content
    );
    const titles = result.findings.map((f) => f.title);
    expect(titles).toContain("Notebook document indicators detected");
    expect(titles).toContain("Executable Python cell indicators detected");
    expect(titles).toContain("Delegated execution indicator detected");
    expect(result.signals.notebookExecuted).toBe(true);
    expect(result.signals.networkingCode).toBe(true);
    expect(result.detectedCapabilities).toEqual(expect.arrayContaining(["requests", "api.github.com"]));
    expect(result.trustBoundaryCrossings).toContain("saas-control-plane->managed-runtime");
  });

  it("detects markdown and metadata notebook signals", () => {
    const content = `
{
  "metadata": {"language_info": {"name": "python"}},
  "cells": [
    {"cell_type": "markdown", "source": ["# Intro"]},
    {"cell_type": "code", "source": ["print('ok')"]}
  ]
}
`;
    const result = recogniseColabSignals("https://colab.research.google.com/github/org/repo/blob/main/a.ipynb", content);
    expect(result.signals.markdownCell).toBe(true);
    expect(result.signals.notebookMetadata).toBe(true);
    expect(result.signals.isNotebookDocument).toBe(true);
  });

  it("recognises execute_request with non-empty code as delegated execution signal", () => {
    const result = recogniseColabWebSocketFrame(
      COLAB_KERNEL_SOCKET_URL,
      JUPYTER_EXECUTE_REQUEST_WITH_CODE,
      "https://colab.research.google.com/drive/sanitized",
      "text"
    );
    expect(result.executeRequestObserved).toBe(true);
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.detectedCapabilities).toEqual(
      expect.arrayContaining(["requests", "api.github.com", "http-method-intent"])
    );
    expect(result.trustBoundaryCrossings).toContain("managed-runtime->potential-external-egress");
    expect(result.codeHash).toHaveLength(64);
    expect(result.protocolObservation?.contentCodeExists).toBe(true);
  });

  it("does not produce execution semantic event for execute_request with empty code", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_EMPTY_CODE);
    expect(result.executeRequestObserved).toBe(true);
    expect(result.executeRequestHasCode).toBe(false);
    expect(result.detectedCapabilities).toHaveLength(0);
  });

  it("recognises nested execute_request payloads", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_NESTED);
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.protocolObservation?.nestedOrWrapped).toBe(true);
    expect(result.protocolObservation?.parseShape).toContain("nested");
    expect(result.protocolObservation?.parentHeaderMsgIdPresent).toBe(true);
  });

  it("recognises array-wrapped execute_request payloads", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_ARRAY_WRAPPED);
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.protocolObservation?.parseShape).toContain("array");
  });

  it("recognises stringified nested execute_request payloads", () => {
    const result = recogniseColabWebSocketFrame(
      COLAB_KERNEL_SOCKET_URL,
      JUPYTER_EXECUTE_REQUEST_STRINGIFIED_NESTED
    );
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.protocolObservation?.parseShape).toContain("stringified");
  });

  it("recognises prefixed execute_request payloads", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_PREFIXED);
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.protocolObservation?.parseShape).toBe("prefixed");
  });

  it("recognises non-execution jupyter status message without execution event", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_STATUS_MESSAGE);
    expect(result.messageType).toBe("status");
    expect(result.executeRequestObserved).toBe(false);
    expect(result.executeRequestHasCode).toBe(false);
  });

  it("recognises LSP didOpen messages as notebook content signal only", () => {
    const result = recogniseColabWebSocketFrame(COLAB_LSP_SOCKET_URL, LSP_DID_OPEN_MESSAGE);
    expect(result.isLspSocket).toBe(true);
    expect(result.notebookContentSignal).toBe(true);
    expect(result.executeRequestObserved).toBe(false);
  });

  it("handles malformed JSON frame safely", () => {
    const result = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, MALFORMED_JSON_FRAME);
    expect(result.executeRequestObserved).toBe(false);
    expect(result.executeRequestHasCode).toBe(false);
  });

  it("handles binary frame metadata safely", () => {
    const result = recogniseColabWebSocketFrame(
      COLAB_KERNEL_SOCKET_URL,
      JUPYTER_EXECUTE_REQUEST_WITH_CODE,
      "https://colab.research.google.com/drive/sanitized",
      "typed-array"
    );
    expect(result.isColabRuntimeSocket).toBe(true);
    expect(result.executeRequestObserved).toBe(true);
    expect(result.protocolObservation?.frameEncoding).toBe("typed-array");
  });

  it("does not infer execution from ordinary Colab XHR payload content", () => {
    const result = recogniseColabSignals("https://colab.research.google.com/drive/sanitized", ORDINARY_COLAB_XHR_PAYLOAD);
    expect(result.signals.notebookExecuted).toBe(false);
  });

  it("parses large valid execute_request frames before display truncation concerns", () => {
    const result = recogniseColabWebSocketFrame(
      COLAB_KERNEL_SOCKET_URL,
      LARGE_JUPYTER_EXECUTE_REQUEST_WITH_CODE,
      "https://colab.research.google.com/drive/sanitized",
      "text"
    );
    expect(result.jupyterEnvelopeParsed).toBe(true);
    expect(result.executeRequestObserved).toBe(true);
    expect(result.executeRequestHasCode).toBe(true);
    expect(result.codeLength).toBeGreaterThan(6000);
    expect(result.parseFailureReason).toBeUndefined();
  });

  it("fails safely on oversized frame without truncation parsing", () => {
    const huge = `{"header":{"msg_type":"execute_request"},"content":{"code":"${"A".repeat(300000)}"}}`;
    const result = recogniseColabWebSocketFrame(
      COLAB_KERNEL_SOCKET_URL,
      huge,
      "https://colab.research.google.com/drive/sanitized",
      "text"
    );
    expect(result.jupyterEnvelopeParsed).toBe(false);
    expect(result.parseFailureReason).toBe("frame-too-large");
  });
});
