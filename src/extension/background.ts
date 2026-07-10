import { classifyPayload } from "../core/classifier.js";
import { buildObservedEvent } from "../core/events.js";
import {
  type AssignmentProvenanceCategory,
  type CorrelatedEvidence,
  type ResolutionFailureReason,
  PythonSemanticSessionStore
} from "../core/python-semantic.js";
import { redactValue } from "../core/redaction.js";
import {
  buildDelegatedExecutionEvent,
  buildTrustBoundaryTimeline,
  computeDelegatedRiskScore
} from "../core/semantic.js";
import { recogniseColabSignals, recogniseColabWebSocketFrame } from "../recognisers/colab.js";
import type {
  ClassificationCategory,
  InstrumentationState,
  InitiatingApi,
  ObserverDiagnostics,
  PanelEventsMessage,
  RuntimeContentStatusMessage,
  RuntimeObservedEventMessage,
  RuntimeWebSocketFrameMessage
} from "../core/types.js";
import {
  isPanelGetEventsMessage,
  isRuntimeContentStatusMessage,
  isRuntimeObservedEventMessage,
  isRuntimeWebSocketFrameMessage
} from "./contracts.js";
import { InMemoryEventStore } from "./event-store.js";

interface RuntimeSender {
  tab?: { id?: number };
  frameId?: number;
}

interface RuntimeApi {
  onMessage: {
    addListener: (
      callback: (
        message: unknown,
        sender: RuntimeSender,
        sendResponse: (response: PanelEventsMessage) => void
      ) => void
    ) => void;
  };
}

interface TabsApi {
  onRemoved: {
    addListener: (callback: (tabId: number) => void) => void;
  };
}

interface ChromeLike {
  runtime?: RuntimeApi;
  tabs?: TabsApi;
}

const getRuntime = (): RuntimeApi | undefined =>
  (globalThis as { chrome?: ChromeLike }).chrome?.runtime;
const getTabsApi = (): TabsApi | undefined =>
  (globalThis as { chrome?: ChromeLike }).chrome?.tabs;

const eventStore = new InMemoryEventStore();
const semanticStore = new PythonSemanticSessionStore();
const KNOWN_APIS = new Set<InitiatingApi>(["fetch", "xhr", "sendBeacon", "websocket", "eventsource"]);

interface TabObserverState {
  pageInstrumentation: InstrumentationState;
  contentBridge: "active" | "unavailable";
  updatedAt: string;
  websocketConnectionsObserved: number;
  websocketOutboundFramesObserved: number;
  jupyterExecutionRequestsObserved: number;
  recogniserState: "active" | "inactive";
  latestProtocolEvent?: string;
  latestMeaningfulExecutionEvent?: string;
  protocolShapeLogsEmitted: number;
  knownSymbolsCount: number;
  knownFunctionsCount: number;
  knownVariablesCount: number;
  currentSemanticSessionHash?: string;
  latestFunctionDefined?: string;
  latestFunctionInvoked?: string;
  latestResolutionResult?: "resolved" | "failed" | "none";
  latestResolutionFailureReason?: ResolutionFailureReason;
  lastStateResetReason?: string;
  totalWebSocketFramesObserved: number;
  textWebSocketFramesObserved: number;
  binaryWebSocketFramesObserved: number;
  latestFrameByteLength?: number;
  latestDisplaySampleLength?: number;
  latestDisplaySampleTruncated?: boolean;
  displaySamplesTruncatedCount: number;
  jupyterParseSuccesses: number;
  jupyterParseFailures: number;
  codeExtractionAttempts: number;
  codeExtractionSuccesses: number;
  codeExtractionFailures: number;
  astAnalysisAttempts: number;
  astAnalysisSuccesses: number;
  astAnalysisFailures: number;
  importsDiscovered: number;
  functionsDiscovered: number;
  assignmentsDiscovered: number;
  callsDiscovered: number;
  semanticFactsEmitted: number;
  latestAnalysisFailureReason?: string;
  functionDefNodesFound: number;
  asyncFunctionDefNodesFound: number;
  latestFunctionNameHash?: string;
  latestFunctionParameterCount?: number;
  latestFunctionDecoratorCount?: number;
  latestFunctionBodyStatementCount?: number;
  latestFunctionNestedCount?: number;
  latestFunctionCapabilityCount?: number;
  latestFunctionSemanticFactEmitted?: boolean;
  functionStoreInsertionAttempted?: boolean;
  functionStoreInsertionSucceeded?: boolean;
  functionStoreInsertionFailureReason?: string;
  // cumulative function pipeline counters
  functionExtractionAttempted: number;
  functionExtractionSucceeded: number;
  functionExtractionFailed: number;
  functionStoreInsertionSucceededCumulative: number;
  functionStoreInsertionFailedCumulative: number;
  functionDroppedCumulative: number;
  // runtime epoch tracking (kernel UUID / connection generation)
  // Separate from the durable tab+notebook semantic scope.
  // A new kernel UUID without a restart signal = reconnect (definitions preserved).
  // A kernelResetSignal = true restart (Python state gone, notebook context cleared).
  currentKernelId?: string;
  kernelEpochChanges: number;
  lastKernelRestartAt?: string;
}

const observerStateByTab = new Map<number, TabObserverState>();
const MAX_PROTOCOL_SHAPE_LOGS_PER_TAB = 40;
const SENSITIVE_CATEGORIES = new Set<ClassificationCategory>([
  "jwt",
  "bearer-token",
  "api-key-like",
  "token-like"
]);

const parseDestination = (url: string, baseUrl: string) => {
  const parsed = new URL(url, baseUrl);
  return {
    url: parsed.toString(),
    host: parsed.host,
    protocol: parsed.protocol,
    port: parsed.port === "" ? undefined : Number(parsed.port)
  };
};

const hashStable = (value: string): string => redactValue("unknown", value).hash;

const extractKernelId = (socketUrl: string): string | undefined => {
  try {
    const parsed = new URL(socketUrl);
    return parsed.pathname.match(/\/api\/kernels\/([^/]+)\/channels/i)?.[1];
  } catch {
    return undefined;
  }
};

const extractNotebookId = (pageUrl: string): string | undefined => {
  try {
    const parsed = new URL(pageUrl);
    const driveMatch = parsed.pathname.match(/\/drive\/([^/?#]+)/i);
    if (driveMatch?.[1]) {
      return driveMatch[1];
    }
    const githubMatch = parsed.pathname.match(/\/github\/([^/?#].*)/i);
    if (githubMatch?.[1]) {
      return githubMatch[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export const buildSemanticContextKey = (_socketUrl: string, pageUrl: string, sender: RuntimeSender): string => {
  const tab = sender.tab?.id ?? -1;
  const pageOriginPath = (() => {
    try {
      const parsed = new URL(pageUrl);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return pageUrl;
    }
  })();
  const notebookHash = hashStable(extractNotebookId(pageUrl) ?? pageOriginPath);
  // Context key is scoped to tab+notebook (the durable notebook identity), not to
  // kernel UUID (the runtime epoch).  Definitions persist across transport reconnects
  // within the same runtime epoch; they do NOT automatically persist across a true
  // kernel restart (Python state is gone) or an undetected runtime replacement.
  // The kernel UUID is tracked separately in TabObserverState.currentKernelId so
  // reconnects vs replacements vs genuine restarts remain observable.
  return `tab:${tab}|notebook:${notebookHash}`;
};

const getOrCreateTabState = (tabId: number): TabObserverState => {
  const existing = observerStateByTab.get(tabId);
  if (existing) {
    return existing;
  }
  const created: TabObserverState = {
    pageInstrumentation: "unknown",
    contentBridge: "unavailable",
    updatedAt: new Date().toISOString(),
    websocketConnectionsObserved: 0,
    websocketOutboundFramesObserved: 0,
    jupyterExecutionRequestsObserved: 0,
    recogniserState: "inactive",
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
  observerStateByTab.set(tabId, created);
  return created;
};

const hasConcreteSensitivePattern = (payloadSample?: string): boolean => {
  if (!payloadSample || payloadSample.trim().length === 0) {
    return false;
  }
  const classification = classifyPayload(payloadSample);
  return classification.categories.some((category) => SENSITIVE_CATEGORIES.has(category));
};

const normalizeApi = (value: string): InitiatingApi =>
  KNOWN_APIS.has(value as InitiatingApi) ? (value as InitiatingApi) : "unknown";

const mergeInstrumentationState = (
  existing: InstrumentationState,
  incoming: InstrumentationState
): InstrumentationState => {
  if (incoming === "active" || existing === "active") {
    return "active";
  }
  if (incoming === "failed" || existing === "failed") {
    return "failed";
  }
  return "unknown";
};

const inferCorrelatedRiskInputs = (
  semanticFromCode: ReturnType<typeof recogniseColabSignals> | undefined,
  invocation: ReturnType<PythonSemanticSessionStore["applyExecution"]>["invocation"] | undefined
) => {
  const inheritedCapabilities = invocation?.inheritedCapabilities ?? [];
  const argumentCategories = new Set<AssignmentProvenanceCategory>(
    invocation?.argumentProvenance.map((value) => value.category) ?? []
  );
  const networkingCode = Boolean(semanticFromCode?.signals.networkingCode || invocation?.egressPotential);
  const githubOutbound = Boolean(
    semanticFromCode?.signals.githubOutbound ||
      inheritedCapabilities.includes("github-target") ||
      (invocation?.knownDestinations.length ?? 0) > 0
  );
  const embeddedData = Boolean(
    semanticFromCode?.signals.embeddedData || argumentCategories.has("embedded-data")
  );
  return {
    notebookEdited: semanticFromCode?.signals.notebookEdited ?? false,
    networkingCode,
    embeddedData,
    bearerTokenPattern:
      semanticFromCode?.signals.bearerTokenPattern ?? argumentCategories.has("token-like"),
    githubOutbound,
    notebookExecuted: true,
    knownOutboundSymbolInvoked: Boolean(invocation?.knownSymbolInvoked && invocation.egressPotential),
    writeCapableHttpBehavior:
      inheritedCapabilities.includes("data-upload") || inheritedCapabilities.includes("outbound-write"),
    knownExternalDestination: (invocation?.knownDestinations.length ?? 0) > 0,
    tokenLikeArgument: argumentCategories.has("token-like"),
    fileContentArgument:
      argumentCategories.has("file-path") || argumentCategories.has("embedded-data"),
    shellOrSubprocessCapability:
      inheritedCapabilities.includes("shell-execution") ||
      inheritedCapabilities.includes("subprocess")
  };
};

const buildDefaultEvidenceSummary = (): CorrelatedEvidence[] => [
  { level: "observed", detail: "Jupyter execute_request observed" },
  { level: "unknown", detail: "Downstream request success" }
];

export const applyWebSocketSemanticToTabState = (
  state: TabObserverState,
  semantic: ReturnType<typeof recogniseColabWebSocketFrame>,
  observedAt: string,
  frameType: RuntimeWebSocketFrameMessage["payload"]["frameType"],
  frameByteLength: number,
  displaySampleLength?: number,
  displaySampleTruncated?: boolean
): TabObserverState => {
  const next: TabObserverState = {
    ...state,
    websocketOutboundFramesObserved: state.websocketOutboundFramesObserved + 1,
    totalWebSocketFramesObserved: state.totalWebSocketFramesObserved + 1,
    textWebSocketFramesObserved:
      state.textWebSocketFramesObserved + (frameType === "text" ? 1 : 0),
    binaryWebSocketFramesObserved:
      state.binaryWebSocketFramesObserved + (frameType === "arraybuffer" || frameType === "typed-array" ? 1 : 0),
    recogniserState: semantic.isColabRuntimeSocket ? "active" : state.recogniserState,
    updatedAt: observedAt,
    latestFrameByteLength: frameByteLength,
    latestDisplaySampleLength: displaySampleLength,
    latestDisplaySampleTruncated: displaySampleTruncated,
    displaySamplesTruncatedCount:
      state.displaySamplesTruncatedCount + (displaySampleTruncated ? 1 : 0)
  };

  if (semantic.jupyterEnvelopeParsed) {
    next.jupyterParseSuccesses += 1;
  } else if (semantic.parseFailureReason) {
    next.jupyterParseFailures += 1;
    next.latestAnalysisFailureReason = semantic.parseFailureReason;
  }

  if (semantic.executeRequestObserved) {
    next.jupyterExecutionRequestsObserved += 1;
    next.codeExtractionAttempts += 1;
    if (semantic.executeRequestHasCode) {
      next.codeExtractionSuccesses += 1;
    } else {
      next.codeExtractionFailures += 1;
      if (semantic.parseFailureReason) {
        next.latestAnalysisFailureReason = semantic.parseFailureReason;
      }
    }
    next.latestProtocolEvent = semantic.executeRequestHasCode
      ? "Jupyter execute_request observed (code present)"
      : "Jupyter execute_request observed (empty code)";

    if (semantic.executeRequestHasCode) {
      next.latestMeaningfulExecutionEvent = "Notebook execution observed (Jupyter execute_request)";
    }
  } else if (semantic.notebookContentSignal) {
    next.latestProtocolEvent = "Colab LSP notebook content signal observed";
  } else if (semantic.messageType) {
    next.latestProtocolEvent = `Jupyter protocol message observed (${semantic.messageType})`;
  }

  return next;
};

const ingestObservedMessage = (message: RuntimeObservedEventMessage, sender: RuntimeSender): void => {
  const observedAt = message.payload.timestamp ?? new Date().toISOString();
  const recogniser = recogniseColabSignals(message.payload.pageUrl, message.payload.payloadSample ?? "");
  const destination = parseDestination(message.payload.url, message.payload.pageUrl);
  const riskScore = computeDelegatedRiskScore(recogniser.signals);
  const timeline = buildTrustBoundaryTimeline(recogniser.signals);
  const delegatedExecutionEvent = recogniser.isColab
    ? buildDelegatedExecutionEvent(recogniser.trigger, recogniser.confidence, recogniser.signals)
    : undefined;

  const event = buildObservedEvent({
    id: crypto.randomUUID(),
    eventSource: "page-world",
    api: normalizeApi(message.payload.api),
    destination,
    context: {
      url: message.payload.pageUrl,
      origin: new URL(message.payload.pageUrl).origin,
      frameId: String(sender.frameId ?? "0"),
      tabId: sender.tab?.id,
      timestamp: observedAt
    },
    observedAt,
    requestMethod: message.payload.method,
    payloadByteLength: message.payload.bodyLength,
    initiatorLocation: message.payload.initiatorLocation,
    payloadSample: message.payload.payloadSample ?? "",
    findings: recogniser.findings,
    riskFlags: [...(hasConcreteSensitivePattern(message.payload.payloadSample) ? ["sensitive-pattern" as const] : [])],
    trustBoundaryEvents: [
      {
        boundaryId: "browser-to-remote-runtime",
        boundaryType: "managed-runtime",
        direction: "out-of",
        details: "Browser-observed request intent may execute beyond enterprise-controlled endpoint."
      }
    ],
    delegatedExecutionEvent,
    timeline,
    riskScore,
    detectedCapabilities: recogniser.detectedCapabilities,
    trustBoundaryCrossings: recogniser.trustBoundaryCrossings
  });

  eventStore.add(event);
  console.info("[WireShadow] background event stored");

  if (typeof sender.tab?.id === "number" && event.api === "websocket") {
    const tabState = getOrCreateTabState(sender.tab.id);
    tabState.websocketConnectionsObserved += 1;
    tabState.updatedAt = observedAt;
    tabState.recogniserState = "active";
    observerStateByTab.set(sender.tab.id, tabState);
  }
};

const ingestWebSocketFrameMessage = (message: RuntimeWebSocketFrameMessage, sender: RuntimeSender): void => {
  const observedAt = message.payload.timestamp;
  const destination = parseDestination(message.payload.socketUrl, message.payload.pageUrl);
  const semanticInput = message.payload.analysisFrameText;
  const wsSemantic = recogniseColabWebSocketFrame(
    message.payload.socketUrl,
    semanticInput,
    message.payload.pageUrl,
    message.payload.frameType
  );

  const semanticContextKey = buildSemanticContextKey(
    message.payload.socketUrl,
    message.payload.pageUrl,
    sender
  );
  if (wsSemantic.kernelResetSignal) {
    semanticStore.resetContext(semanticContextKey);
    if (typeof sender.tab?.id === "number") {
      const resetState = getOrCreateTabState(sender.tab.id);
      resetState.lastStateResetReason = "state-reset";
      resetState.lastKernelRestartAt = observedAt;
      observerStateByTab.set(sender.tab.id, resetState);
    }
  }

  // Runtime epoch tracking: kernel UUID is diagnostically tracked separately from
  // the durable tab+notebook semantic scope.  A new UUID without a restart signal
  // is a reconnect (definitions preserved).  A restart signal means Python state
  // is gone and we already cleared the notebook context above.
  if (typeof sender.tab?.id === "number") {
    const epochState = getOrCreateTabState(sender.tab.id);
    const observedKernelId = extractKernelId(message.payload.socketUrl);
    if (observedKernelId !== undefined && observedKernelId !== epochState.currentKernelId) {
      epochState.kernelEpochChanges += 1;
      epochState.currentKernelId = observedKernelId;
      observerStateByTab.set(sender.tab.id, epochState);
    }
  }

  const semanticFromCode =
    wsSemantic.executeRequestHasCode && wsSemantic.codeSample
      ? recogniseColabSignals(message.payload.pageUrl, wsSemantic.codeSample)
      : undefined;

  const codeAnalysisAttempted = wsSemantic.executeRequestHasCode;
  const semanticExecution =
    wsSemantic.executeRequestHasCode && wsSemantic.codeSample
      ? semanticStore.applyExecution(semanticContextKey, wsSemantic.codeSample, observedAt)
      : undefined;
  const invocation = semanticExecution?.invocation;
  const firstObservedCall = semanticExecution?.calls[0];
  let resolutionFailureReason = semanticExecution?.resolutionFailureReason;
  if (resolutionFailureReason === "definition-not-seen" && firstObservedCall) {
    const callParts = firstObservedCall.split(".");
    const callee = callParts[callParts.length - 1] ?? firstObservedCall;
    if (semanticStore.hasSymbolInSiblingContext(semanticContextKey, callee)) {
      resolutionFailureReason = "session-mismatch";
    }
  }
  const correlatedInputs =
    wsSemantic.executeRequestHasCode
      ? inferCorrelatedRiskInputs(semanticFromCode, invocation)
      : undefined;

  const riskScore = correlatedInputs ? computeDelegatedRiskScore(correlatedInputs) : undefined;
  const timeline = correlatedInputs ? buildTrustBoundaryTimeline(correlatedInputs) : [];
  const delegatedExecutionEvent = correlatedInputs
    ? buildDelegatedExecutionEvent("jupyter-execute-request", wsSemantic.confidence, correlatedInputs, {
        knownSymbolInvoked: invocation?.knownSymbolInvoked,
        inheritedCapabilities: invocation?.inheritedCapabilities
      })
    : undefined;

  const riskFlags: Array<
    "delegated-execution" | "hidden-egress" | "embedded-data" | "code-execution" | "sensitive-pattern"
  > = [];
  if (wsSemantic.executeRequestHasCode && correlatedInputs) {
    riskFlags.push("delegated-execution", "code-execution");
    if (correlatedInputs.networkingCode) {
      riskFlags.push("hidden-egress");
    }
    if (correlatedInputs.embeddedData) {
      riskFlags.push("embedded-data");
    }
    if (hasConcreteSensitivePattern(wsSemantic.codeSample) || correlatedInputs.tokenLikeArgument) {
      riskFlags.push("sensitive-pattern");
    }
  }

  const trustBoundaryCrossings = wsSemantic.executeRequestHasCode
    ? [
        "browser->saas-control-plane",
        "saas-control-plane->managed-runtime",
        ...(correlatedInputs?.networkingCode ? ["managed-runtime->potential-external-egress"] : [])
      ]
    : wsSemantic.trustBoundaryCrossings;

  const event = buildObservedEvent({
    id: crypto.randomUUID(),
    eventSource: "page-world",
    api: "websocket",
    destination,
    context: {
      url: message.payload.pageUrl,
      origin: new URL(message.payload.pageUrl).origin,
      frameId: String(sender.frameId ?? "0"),
      tabId: sender.tab?.id,
      timestamp: observedAt
    },
    observedAt,
    requestMethod: "SEND",
    payloadByteLength: message.payload.frameByteLength,
    initiatorLocation: message.payload.initiatorLocation,
    payloadSample: wsSemantic.executeRequestHasCode
      ? `[jupyter-code-redacted length=${wsSemantic.codeLength ?? 0}]`
      : message.payload.payloadSample ?? "",
    findings: wsSemantic.findings,
    riskFlags,
    trustBoundaryEvents: [
      {
        boundaryId: "browser-to-saas-control-plane",
        boundaryType: "saas-control-plane",
        direction: "out-of",
        details: "Browser-observed WebSocket frame sent to Colab control plane."
      },
      ...(wsSemantic.executeRequestHasCode
        ? [
            {
              boundaryId: "saas-control-plane-to-managed-runtime",
              boundaryType: "managed-runtime" as const,
              direction: "out-of" as const,
              details: "Jupyter execute_request indicates delegated execution in managed runtime."
            }
          ]
        : [])
    ],
    delegatedExecutionEvent,
    evidenceSummary: invocation?.evidence ?? (wsSemantic.executeRequestHasCode ? buildDefaultEvidenceSummary() : []),
    timeline,
    riskScore,
    detectedCapabilities: Array.from(
      new Set([...(wsSemantic.detectedCapabilities ?? []), ...(invocation?.inheritedCapabilities ?? [])])
    ),
    trustBoundaryCrossings,
    metadata: {
      websocketFrameType: message.payload.frameType,
      websocketFrameByteLength: message.payload.frameByteLength,
      websocketMessageType: wsSemantic.messageType ?? "unknown",
      jupyterCodeLength: wsSemantic.codeLength ?? 0,
      jupyterCodeHash: wsSemantic.codeHash ?? "none",
      jupyterNestedOrWrapped: wsSemantic.protocolObservation?.nestedOrWrapped ?? false,
      jupyterParseShape: wsSemantic.protocolObservation?.parseShape ?? "none",
      jupyterFrameEncoding: wsSemantic.protocolObservation?.frameEncoding ?? message.payload.frameType,
      semanticContextKeyHash: hashStable(semanticContextKey),
      knownSymbolHash: invocation?.knownSymbolInvoked ? hashStable(invocation.knownSymbolInvoked) : "none",
      semanticExecutionIdHash: hashStable(
        `${semanticContextKey}|${wsSemantic.codeHash ?? "none"}|${message.payload.timestamp}`
      ),
      semanticStatementKinds:
        semanticExecution?.diagnostics.statementKinds.join(",") ??
        (wsSemantic.executeRequestHasCode ? "unknown" : "none"),
      semanticImportsDetected: semanticExecution?.diagnostics.importsDetected ?? 0,
      semanticFunctionDefinitionsDetected: semanticExecution?.diagnostics.functionDefinitionsDetected ?? 0,
      semanticAssignmentsDetected: semanticExecution?.diagnostics.assignmentsDetected ?? 0,
      semanticCallsDetected: semanticExecution?.diagnostics.callsDetected ?? 0,
      semanticCallResolved: semanticExecution?.diagnostics.callResolved ?? false,
      semanticResolutionFailureReason: resolutionFailureReason ?? "none",
      semanticArgumentProvenance:
        invocation?.argumentProvenance.map((value) => value.category).join(",") ?? "none",
      semanticStoreSizeBefore: semanticExecution?.diagnostics.semanticStoreSizeBefore ?? 0,
      semanticStoreSizeAfter: semanticExecution?.diagnostics.semanticStoreSizeAfter ?? 0,
      analysisInputLength: message.payload.analysisFrameTextLength ?? 0,
      analysisInputProvided: typeof message.payload.analysisFrameText === "string",
      analysisDisplaySampleLength: message.payload.payloadSampleLength ?? (message.payload.payloadSample?.length ?? 0),
      analysisDisplaySampleTruncated: message.payload.payloadSampleTruncated ?? false,
      analysisEligibilityFailureReason: message.payload.analysisEligibilityFailureReason ?? "none",
      semanticParseFailureReason: wsSemantic.parseFailureReason ?? "none"
    }
  });

  eventStore.add(event);
  console.info("[WireShadow] background event stored");

  if (typeof sender.tab?.id === "number") {
    let tabState = getOrCreateTabState(sender.tab.id);
    tabState = applyWebSocketSemanticToTabState(
      tabState,
      wsSemantic,
      observedAt,
      message.payload.frameType,
      message.payload.frameByteLength,
      message.payload.payloadSampleLength ?? message.payload.payloadSample?.length,
      message.payload.payloadSampleTruncated
    );
    if (invocation?.knownSymbolInvoked) {
      tabState.latestMeaningfulExecutionEvent = `${invocation.knownSymbolInvoked}(...) invoked`;
    }
    if (semanticExecution) {
      // Only update counts/latest-state from actual semantic execution so that
      // non-execution frames (heartbeats, status, LSP) do not overwrite them.
      tabState.currentSemanticSessionHash = hashStable(semanticContextKey);
      tabState.knownFunctionsCount = semanticExecution.diagnostics.semanticStoreFunctionsAfter;
      tabState.knownVariablesCount = semanticExecution.diagnostics.semanticStoreVariablesAfter;
      tabState.knownSymbolsCount = tabState.knownFunctionsCount + tabState.knownVariablesCount;
      if (semanticExecution.diagnostics.latestFunctionDefined) {
        tabState.latestFunctionDefined = semanticExecution.diagnostics.latestFunctionDefined;
      }
      if (semanticExecution.diagnostics.latestFunctionInvoked) {
        tabState.latestFunctionInvoked = semanticExecution.diagnostics.latestFunctionInvoked;
      }
    }
    if (semanticExecution?.diagnostics.latestResolutionResult) {
      tabState.latestResolutionResult = semanticExecution.diagnostics.latestResolutionResult;
    }
    const resolvedFailureReason = resolutionFailureReason ?? semanticExecution?.diagnostics.latestResolutionFailureReason;
    if (resolvedFailureReason !== undefined) {
      tabState.latestResolutionFailureReason = resolvedFailureReason as ResolutionFailureReason;
    }
    if (codeAnalysisAttempted) {
      tabState.astAnalysisAttempts += 1;
      if (semanticExecution) {
        tabState.astAnalysisSuccesses += 1;
        tabState.importsDiscovered += semanticExecution.diagnostics.importsDetected;
        tabState.functionsDiscovered += semanticExecution.diagnostics.functionDefinitionsDetected;
        tabState.assignmentsDiscovered += semanticExecution.diagnostics.assignmentsDetected;
        tabState.callsDiscovered += semanticExecution.diagnostics.callsDetected;
        tabState.functionDefNodesFound += semanticExecution.diagnostics.functionDefNodesFound;
        tabState.asyncFunctionDefNodesFound += semanticExecution.diagnostics.asyncFunctionDefNodesFound;
        tabState.latestFunctionNameHash = semanticExecution.diagnostics.latestFunctionNameHash;
        tabState.latestFunctionParameterCount = semanticExecution.diagnostics.latestFunctionParameterCount;
        tabState.latestFunctionDecoratorCount = semanticExecution.diagnostics.latestFunctionDecoratorCount;
        tabState.latestFunctionBodyStatementCount = semanticExecution.diagnostics.latestFunctionBodyStatementCount;
        tabState.latestFunctionNestedCount = semanticExecution.diagnostics.latestFunctionNestedCount;
        tabState.latestFunctionCapabilityCount = semanticExecution.diagnostics.latestFunctionCapabilityCount;
        tabState.latestFunctionSemanticFactEmitted = semanticExecution.diagnostics.latestFunctionSemanticFactEmitted;
        tabState.functionStoreInsertionAttempted = semanticExecution.diagnostics.functionStoreInsertionAttempted;
        tabState.functionStoreInsertionSucceeded = semanticExecution.diagnostics.functionStoreInsertionSucceeded;
        tabState.functionStoreInsertionFailureReason =
          semanticExecution.diagnostics.functionStoreInsertionFailureReason;
        // cumulative function pipeline counters
        tabState.functionExtractionAttempted += semanticExecution.diagnostics.functionExtractionAttemptedCount;
        tabState.functionExtractionSucceeded += semanticExecution.diagnostics.functionExtractionSucceededCount;
        tabState.functionExtractionFailed += semanticExecution.diagnostics.functionExtractionFailedCount;
        tabState.functionStoreInsertionSucceededCumulative += semanticExecution.diagnostics.functionStoreInsertionSucceededCount;
        tabState.functionStoreInsertionFailedCumulative += semanticExecution.diagnostics.functionStoreInsertionFailedCount;
        tabState.functionDroppedCumulative += semanticExecution.diagnostics.functionDroppedCount;
        const emittedFacts =
          semanticExecution.diagnostics.importsDetected +
          semanticExecution.diagnostics.functionDefinitionsDetected +
          semanticExecution.diagnostics.assignmentsDetected +
          semanticExecution.diagnostics.callsDetected;
        tabState.semanticFactsEmitted += emittedFacts;
        if (emittedFacts === 0) {
          tabState.latestAnalysisFailureReason =
            semanticExecution.diagnostics.latestFunctionAnalysisFailureReason ?? "no-supported-statements";
        } else {
          tabState.latestAnalysisFailureReason = semanticExecution.diagnostics.latestFunctionAnalysisFailureReason;
        }
      } else {
        tabState.astAnalysisFailures += 1;
        tabState.latestAnalysisFailureReason =
          wsSemantic.parseFailureReason ??
          message.payload.analysisEligibilityFailureReason ??
          "ast-parse-failed";
      }
    }
    if (!semanticInput && message.payload.payloadSampleTruncated) {
      tabState.latestAnalysisFailureReason = "frame-truncated-before-parse";
    }
    if (semanticExecution?.diagnostics.stateResetReason) {
      tabState.lastStateResetReason = semanticExecution.diagnostics.stateResetReason;
    }

    if (wsSemantic.protocolObservation && tabState.protocolShapeLogsEmitted < MAX_PROTOCOL_SHAPE_LOGS_PER_TAB) {
      console.info("[WireShadow] jupyter-frame-shape", wsSemantic.protocolObservation);
      tabState.protocolShapeLogsEmitted += 1;
    }

    observerStateByTab.set(sender.tab.id, tabState);
  }
};

const ingestContentStatus = (message: RuntimeContentStatusMessage, sender: RuntimeSender): void => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return;
  }
  const existing = getOrCreateTabState(tabId);
  observerStateByTab.set(tabId, {
    ...existing,
    pageInstrumentation: mergeInstrumentationState(existing.pageInstrumentation, message.payload.pageInstrumentation),
    contentBridge: message.payload.contentBridgeReady ? "active" : existing.contentBridge,
    updatedAt: message.payload.timestamp
  });
};

const buildDiagnostics = (tabId: number | undefined, eventsObserved: number): ObserverDiagnostics => {
  if (typeof tabId !== "number") {
    return {
      pageInstrumentation: "unknown",
      contentBridge: "unavailable",
      backgroundObserver: "active",
      eventsObserved,
      websocketConnectionsObserved: 0,
      websocketOutboundFramesObserved: 0,
      jupyterExecutionRequestsObserved: 0,
      recogniserState: "inactive",
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
      asyncFunctionDefNodesFound: 0
    };
  }

  const tabState = observerStateByTab.get(tabId);
  return {
    pageInstrumentation: tabState?.pageInstrumentation ?? "unknown",
    contentBridge: tabState?.contentBridge ?? "unavailable",
    backgroundObserver: "active",
    eventsObserved,
    websocketConnectionsObserved: tabState?.websocketConnectionsObserved ?? 0,
    websocketOutboundFramesObserved: tabState?.websocketOutboundFramesObserved ?? 0,
    jupyterExecutionRequestsObserved: tabState?.jupyterExecutionRequestsObserved ?? 0,
    recogniserState: tabState?.recogniserState ?? "inactive",
    latestProtocolEvent: tabState?.latestProtocolEvent,
    latestMeaningfulExecutionEvent: tabState?.latestMeaningfulExecutionEvent,
    lastSemanticEvent: tabState?.latestMeaningfulExecutionEvent,
    knownSymbolsCount: tabState?.knownSymbolsCount ?? 0,
    knownFunctionsCount: tabState?.knownFunctionsCount ?? 0,
    knownVariablesCount: tabState?.knownVariablesCount ?? 0,
    currentSemanticSessionHash: tabState?.currentSemanticSessionHash,
    latestFunctionDefined: tabState?.latestFunctionDefined,
    latestFunctionInvoked: tabState?.latestFunctionInvoked,
    latestResolutionResult: tabState?.latestResolutionResult,
    latestResolutionFailureReason: tabState?.latestResolutionFailureReason,
    lastStateResetReason: tabState?.lastStateResetReason,
    totalWebSocketFramesObserved: tabState?.totalWebSocketFramesObserved ?? 0,
    textWebSocketFramesObserved: tabState?.textWebSocketFramesObserved ?? 0,
    binaryWebSocketFramesObserved: tabState?.binaryWebSocketFramesObserved ?? 0,
    latestFrameByteLength: tabState?.latestFrameByteLength,
    latestDisplaySampleLength: tabState?.latestDisplaySampleLength,
    latestDisplaySampleTruncated: tabState?.latestDisplaySampleTruncated,
    displaySamplesTruncatedCount: tabState?.displaySamplesTruncatedCount ?? 0,
    jupyterParseSuccesses: tabState?.jupyterParseSuccesses ?? 0,
    jupyterParseFailures: tabState?.jupyterParseFailures ?? 0,
    codeExtractionAttempts: tabState?.codeExtractionAttempts ?? 0,
    codeExtractionSuccesses: tabState?.codeExtractionSuccesses ?? 0,
    codeExtractionFailures: tabState?.codeExtractionFailures ?? 0,
    astAnalysisAttempts: tabState?.astAnalysisAttempts ?? 0,
    astAnalysisSuccesses: tabState?.astAnalysisSuccesses ?? 0,
    astAnalysisFailures: tabState?.astAnalysisFailures ?? 0,
    importsDiscovered: tabState?.importsDiscovered ?? 0,
    functionsDiscovered: tabState?.functionsDiscovered ?? 0,
    assignmentsDiscovered: tabState?.assignmentsDiscovered ?? 0,
    callsDiscovered: tabState?.callsDiscovered ?? 0,
    semanticFactsEmitted: tabState?.semanticFactsEmitted ?? 0,
    latestAnalysisFailureReason: tabState?.latestAnalysisFailureReason,
    functionDefNodesFound: tabState?.functionDefNodesFound ?? 0,
    asyncFunctionDefNodesFound: tabState?.asyncFunctionDefNodesFound ?? 0,
    latestFunctionNameHash: tabState?.latestFunctionNameHash,
    latestFunctionParameterCount: tabState?.latestFunctionParameterCount,
    latestFunctionDecoratorCount: tabState?.latestFunctionDecoratorCount,
    latestFunctionBodyStatementCount: tabState?.latestFunctionBodyStatementCount,
    latestFunctionNestedCount: tabState?.latestFunctionNestedCount,
    latestFunctionCapabilityCount: tabState?.latestFunctionCapabilityCount,
    latestFunctionSemanticFactEmitted: tabState?.latestFunctionSemanticFactEmitted,
    functionStoreInsertionAttempted: tabState?.functionStoreInsertionAttempted,
    functionStoreInsertionSucceeded: tabState?.functionStoreInsertionSucceeded,
    functionStoreInsertionFailureReason: tabState?.functionStoreInsertionFailureReason,
    functionExtractionAttempted: tabState?.functionExtractionAttempted ?? 0,
    functionExtractionSucceeded: tabState?.functionExtractionSucceeded ?? 0,
    functionExtractionFailed: tabState?.functionExtractionFailed ?? 0,
    functionStoreInsertionSucceededCount: tabState?.functionStoreInsertionSucceededCumulative ?? 0,
    functionStoreInsertionFailedCount: tabState?.functionStoreInsertionFailedCumulative ?? 0,
    functionDroppedCount: tabState?.functionDroppedCumulative ?? 0,
    currentKernelId: tabState?.currentKernelId,
    kernelEpochChanges: tabState?.kernelEpochChanges ?? 0,
    lastKernelRestartAt: tabState?.lastKernelRestartAt
  };
};

const startBackgroundObserver = (): void => {
  const runtime = getRuntime();
  if (!runtime) {
    return;
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isRuntimeObservedEventMessage(message)) {
      ingestObservedMessage(message, sender);
      return;
    }

    if (isRuntimeContentStatusMessage(message)) {
      ingestContentStatus(message, sender);
      return;
    }

    if (isRuntimeWebSocketFrameMessage(message)) {
      ingestWebSocketFrameMessage(message, sender);
      return;
    }

    if (isPanelGetEventsMessage(message)) {
      const tabId = typeof message.tabId === "number" ? message.tabId : sender.tab?.id;
      const events = eventStore.getEvents(tabId);
      sendResponse({
        type: "wireshadow-panel-events",
        payload: {
          events,
          diagnostics: buildDiagnostics(tabId, events.length)
        }
      });
    }
  });

  getTabsApi()?.onRemoved.addListener((tabId) => {
    observerStateByTab.delete(tabId);
    semanticStore.resetTab(`tab:${tabId}|`);
  });
};

startBackgroundObserver();
