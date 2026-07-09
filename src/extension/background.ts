import { buildObservedEvent } from "../core/events.js";
import {
  buildDelegatedExecutionEvent,
  buildTrustBoundaryTimeline,
  computeDelegatedRiskScore
} from "../core/semantic.js";
import { recogniseColabSignals } from "../recognisers/colab.js";
import type {
  InitiatingApi,
  PanelEventsMessage,
  RuntimeObservedEventMessage
} from "../core/types.js";
import { isPanelGetEventsMessage, isRuntimeObservedEventMessage } from "./contracts.js";
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

const parseDestination = (url: string, baseUrl: string) => {
  const parsed = new URL(url, baseUrl);
  return {
    url: parsed.toString(),
    host: parsed.host,
    protocol: parsed.protocol,
    port: parsed.port === "" ? undefined : Number(parsed.port)
  };
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

    if (isPanelGetEventsMessage(message)) {
      const tabId = typeof message.tabId === "number" ? message.tabId : sender.tab?.id;
      sendResponse({
        type: "wireshadow-panel-events",
        payload: {
          events: eventStore.getEvents(tabId)
        }
      });
    }
  });
};

startBackgroundObserver();
