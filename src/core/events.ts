import { classifyPayload, classifyUrl } from "./classifier.js";
import type {
  DelegatedExecutionEvent,
  Destination,
  SemanticEvidence,
  EventSource,
  InitiatingApi,
  ObservedEvent,
  PageFrameContext,
  RiskScore,
  RecogniserFinding,
  RiskFlag,
  TrustBoundaryTimelineEvent,
  TrustBoundaryEvent
} from "./types.js";

export interface BuildObservedEventInput {
  id: string;
  eventSource?: EventSource;
  api: InitiatingApi;
  destination: Destination;
  context: PageFrameContext;
  observedAt?: string;
  requestMethod?: string;
  payloadByteLength?: number;
  initiatorLocation?: string;
  payloadSample?: string;
  metadata?: Record<string, string | number | boolean>;
  findings?: RecogniserFinding[];
  riskFlags?: RiskFlag[];
  trustBoundaryEvents?: TrustBoundaryEvent[];
  delegatedExecutionEvent?: DelegatedExecutionEvent;
  evidenceSummary?: SemanticEvidence[];
  timeline?: TrustBoundaryTimelineEvent[];
  riskScore?: RiskScore;
  detectedCapabilities?: string[];
  trustBoundaryCrossings?: string[];
  causes?: string[];
}

export const buildObservedEvent = ({
  id,
  eventSource = "page-world",
  api,
  destination,
  context,
  observedAt = new Date().toISOString(),
  requestMethod,
  payloadByteLength,
  initiatorLocation,
  payloadSample = "",
  metadata = {},
  findings = [],
  riskFlags = [],
  trustBoundaryEvents = [],
  delegatedExecutionEvent,
  evidenceSummary,
  timeline = [],
  riskScore,
  detectedCapabilities = [],
  trustBoundaryCrossings = [],
  causes = []
}: BuildObservedEventInput): ObservedEvent => {
  const payload = classifyPayload(payloadSample);
  const destinationEvidence = classifyUrl(destination.url);

  return {
    id,
    observedAt,
    eventSource,
    api,
    destination,
    context,
    method: requestMethod,
    metadata: {
      ...metadata,
      ...(typeof payloadByteLength === "number" ? { requestBodyLength: payloadByteLength } : {}),
      ...(initiatorLocation ? { initiatorHash: classifyUrl(initiatorLocation).hash } : {}),
      destinationHash: destinationEvidence.hash
    },
    classification: payload,
    riskFlags: Array.from(new Set(riskFlags)),
    recogniserFindings: findings,
    trustBoundaryEvents,
    delegatedExecutionEvent,
    evidenceSummary,
    timeline,
    riskScore,
    detectedCapabilities: Array.from(new Set(detectedCapabilities)),
    trustBoundaryCrossings: Array.from(new Set(trustBoundaryCrossings)),
    causalRefs: causes.map((eventId) => ({
      eventId,
      relation: "preceded-by" as const
    }))
  };
};
