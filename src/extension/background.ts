import { buildObservedEvent } from "../core/events.js";
import {
  buildDelegatedExecutionEvent,
  buildTrustBoundaryTimeline,
  computeDelegatedRiskScore
} from "../core/semantic.js";
import { recogniseColabSignals, recogniseColabWebSocketFrame } from "../recognisers/colab.js";
import type {
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

interface ChromeLike {
  runtime?: RuntimeApi;
}

const getRuntime = (): RuntimeApi | undefined =>
  (globalThis as { chrome?: ChromeLike }).chrome?.runtime;

const eventStore = new InMemoryEventStore();
const KNOWN_APIS = new Set<InitiatingApi>(["fetch", "xhr", "sendBeacon", "websocket", "eventsource"]);

interface TabObserverState {
  pageInstrumentation: InstrumentationState;
  contentBridge: "active" | "unavailable";
  updatedAt: string;
  websocketConnectionsObserved: number;
  websocketOutboundFramesObserved: number;
  jupyterExecutionRequestsObserved: number;
  recogniserState: "active" | "inactive";
  lastSemanticEvent?: string;
}

const observerStateByTab = new Map<number, TabObserverState>();

const parseDestination = (url: string, baseUrl: string) => {
  const parsed = new URL(url, baseUrl);
  return {
    url: parsed.toString(),
    host: parsed.host,
    protocol: parsed.protocol,
    port: parsed.port === "" ? undefined : Number(parsed.port)
  };
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
    recogniserState: "inactive"
  };
  observerStateByTab.set(tabId, created);
  return created;
};

const normalizeApi = (value: string): InitiatingApi =>
  KNOWN_APIS.has(value as InitiatingApi) ? (value as InitiatingApi) : "unknown";

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
    riskFlags: [
      ...(recogniser.findings.length > 0 ? ["delegated-execution" as const] : []),
      ...(recogniser.signals.networkingCode ? ["hidden-egress" as const] : []),
      ...(recogniser.signals.embeddedData ? ["embedded-data" as const] : []),
      ...(recogniser.signals.notebookExecuted ? ["code-execution" as const] : []),
      ...((message.payload.payloadSample?.length ?? 0) > 0 ? ["sensitive-pattern" as const] : [])
    ],
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
  const wsSemantic = recogniseColabWebSocketFrame(
    message.payload.socketUrl,
    message.payload.payloadSample,
    message.payload.pageUrl
  );

  const semanticFromCode =
    wsSemantic.executeRequestHasCode && wsSemantic.codeSample
      ? recogniseColabSignals(message.payload.pageUrl, wsSemantic.codeSample)
      : undefined;

  const riskScore = semanticFromCode ? computeDelegatedRiskScore(semanticFromCode.signals) : undefined;
  const timeline = semanticFromCode ? buildTrustBoundaryTimeline(semanticFromCode.signals) : [];
  const delegatedExecutionEvent = semanticFromCode
    ? buildDelegatedExecutionEvent("jupyter-execute-request", wsSemantic.confidence, semanticFromCode.signals)
    : undefined;

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
    payloadSample: wsSemantic.codeSample ?? message.payload.payloadSample ?? "",
    findings: wsSemantic.findings,
    riskFlags: [
      ...(wsSemantic.executeRequestHasCode ? (["delegated-execution", "code-execution"] as const) : []),
      ...(wsSemantic.detectedCapabilities.length > 0 ? (["hidden-egress"] as const) : []),
      ...((wsSemantic.codeSample ?? message.payload.payloadSample ?? "").length > 0
        ? (["sensitive-pattern"] as const)
        : [])
    ],
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
    timeline,
    riskScore,
    detectedCapabilities: wsSemantic.detectedCapabilities,
    trustBoundaryCrossings: wsSemantic.trustBoundaryCrossings,
    metadata: {
      websocketFrameType: message.payload.frameType,
      websocketFrameByteLength: message.payload.frameByteLength,
      websocketMessageType: wsSemantic.messageType ?? "unknown"
    }
  });

  eventStore.add(event);
  console.info("[WireShadow] background event stored");

  if (typeof sender.tab?.id === "number") {
    const tabState = getOrCreateTabState(sender.tab.id);
    tabState.websocketOutboundFramesObserved += 1;
    if (wsSemantic.executeRequestObserved) {
      tabState.jupyterExecutionRequestsObserved += 1;
      tabState.lastSemanticEvent = wsSemantic.executeRequestHasCode
        ? "Notebook execution observed (Jupyter execute_request)"
        : "Jupyter execute_request observed (empty code)";
    } else if (wsSemantic.notebookContentSignal) {
      tabState.lastSemanticEvent = "Colab LSP notebook content signal observed";
    }
    if (wsSemantic.isColabRuntimeSocket) {
      tabState.recogniserState = "active";
    }
    tabState.updatedAt = observedAt;
    observerStateByTab.set(sender.tab.id, tabState);
  }
};

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
      recogniserState: "inactive"
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
    lastSemanticEvent: tabState?.lastSemanticEvent
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
};

startBackgroundObserver();
