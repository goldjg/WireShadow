import { describe, expect, it } from "vitest";
import { applyWebSocketSemanticToTabState } from "../src/extension/background.js";
import { recogniseColabWebSocketFrame } from "../src/recognisers/colab.js";
import {
  COLAB_KERNEL_SOCKET_URL,
  JUPYTER_EXECUTE_REQUEST_EMPTY_CODE,
  JUPYTER_EXECUTE_REQUEST_WITH_CODE
} from "./fixtures/colab-websocket-fixtures.js";

describe("background semantic state", () => {
  it("preserves latest meaningful execution when a later empty execute_request arrives", () => {
    const baseState = {
      pageInstrumentation: "active" as const,
      contentBridge: "active" as const,
      updatedAt: new Date().toISOString(),
      websocketConnectionsObserved: 1,
      websocketOutboundFramesObserved: 0,
      jupyterExecutionRequestsObserved: 0,
      recogniserState: "active" as const,
      protocolShapeLogsEmitted: 0,
      knownSymbolsCount: 0,
      knownFunctionsCount: 0,
      knownVariablesCount: 0,
      totalWebSocketFramesObserved: 0,
      textWebSocketFramesObserved: 0,
      binaryWebSocketFramesObserved: 0,
      jupyterParseSuccesses: 0,
      jupyterParseFailures: 0,
      codeExtractionAttempts: 0,
      codeExtractionSuccesses: 0,
      codeExtractionFailures: 0,
      astAnalysisAttempts: 0,
      astAnalysisSuccesses: 0,
      astAnalysisFailures: 0,
      importsDiscovered: 0,
      functionsDiscovered: 0,
      assignmentsDiscovered: 0,
      callsDiscovered: 0,
      semanticFactsEmitted: 0,
      displaySamplesTruncatedCount: 0,
      functionDefNodesFound: 0,
      asyncFunctionDefNodesFound: 0,
      functionExtractionAttempted: 0,
      functionExtractionSucceeded: 0,
      functionExtractionFailed: 0,
      functionStoreInsertionSucceededCumulative: 0,
      functionStoreInsertionFailedCumulative: 0,
      functionDroppedCumulative: 0,
      kernelEpochChanges: 0
    };

    const withCode = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_WITH_CODE);
    const afterCode = applyWebSocketSemanticToTabState(
      baseState,
      withCode,
      new Date().toISOString(),
      "text",
      120,
      120,
      false
    );
    expect(afterCode.latestMeaningfulExecutionEvent).toContain("Notebook execution observed");

    const empty = recogniseColabWebSocketFrame(COLAB_KERNEL_SOCKET_URL, JUPYTER_EXECUTE_REQUEST_EMPTY_CODE);
    const afterEmpty = applyWebSocketSemanticToTabState(
      afterCode,
      empty,
      new Date().toISOString(),
      "text",
      50,
      50,
      false
    );
    expect(afterEmpty.latestMeaningfulExecutionEvent).toContain("Notebook execution observed");
    expect(afterEmpty.latestProtocolEvent).toContain("empty code");
    expect(afterEmpty.jupyterExecutionRequestsObserved).toBe(2);
  });
});
