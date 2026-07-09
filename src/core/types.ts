export type InitiatingApi =
  | "fetch"
  | "xhr"
  | "sendBeacon"
  | "websocket"
  | "eventsource"
  | "unknown";

export type EventSource = "page-world";

export interface Destination {
  url: string;
  host: string;
  protocol: string;
  port?: number;
}

export interface PageFrameContext {
  url: string;
  origin: string;
  frameId: string;
  tabId?: number;
  timestamp: string;
}

export type ClassificationCategory =
  | "url"
  | "email"
  | "jwt"
  | "bearer-token"
  | "uuid"
  | "ip-address"
  | "token-like"
  | "api-key-like"
  | "base64-blob"
  | "embedded-data"
  | "source-code"
  | "python-networking"
  | "urllib3"
  | "aiohttp"
  | "socket"
  | "websocket-client"
  | "subprocess"
  | "os-system"
  | "curl"
  | "wget"
  | "pygithub"
  | "cloud-storage-api"
  | "http-method-intent"
  | "notebook-metadata"
  | "github-api"
  | "gist-api"
  | "requests-post"
  | "requests-get"
  | "urllib"
  | "httpx"
  | "unknown";

export interface RedactedEvidence {
  category: ClassificationCategory;
  length: number;
  hash: string;
  evidence: string;
}

export interface PayloadClassification {
  categories: ClassificationCategory[];
  evidence: RedactedEvidence[];
  confidence: number;
}

export type RiskFlag =
  | "delegated-execution"
  | "hidden-egress"
  | "embedded-data"
  | "code-execution"
  | "sensitive-pattern";

export interface RecogniserFinding {
  recogniserId: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  tags: string[];
}

export interface TrustBoundaryEvent {
  boundaryId: string;
  boundaryType: "browser" | "saas-control-plane" | "managed-runtime" | "external-egress";
  direction: "into" | "out-of";
  details: string;
}

export interface CausalRef {
  eventId: string;
  relation:
    | "initiated-by"
    | "preceded-by"
    | "triggered-runtime-execution"
    | "same-session";
}

export type DelegatedExecutionPlatform = "google-colab" | "unknown";

export interface DelegatedExecutionEvent {
  executionPlatform: DelegatedExecutionPlatform;
  confidence: number;
  trigger: string;
  executionLanguage: string;
  outboundCapabilityDetected: boolean;
  embeddedDataDetected: boolean;
  trustBoundaryCrossed: boolean;
}

export interface TrustBoundaryTimelineEvent {
  step: number;
  title: string;
  details: string;
}

export interface RiskScoreFactor {
  id: string;
  title: string;
  score: number;
  detected: boolean;
}

export interface RiskScore {
  total: number;
  factors: RiskScoreFactor[];
}

export interface ObservedEvent {
  id: string;
  observedAt: string;
  eventSource: EventSource;
  api: InitiatingApi;
  destination: Destination;
  context: PageFrameContext;
  method?: string;
  metadata: Record<string, string | number | boolean>;
  classification: PayloadClassification;
  riskFlags: RiskFlag[];
  recogniserFindings: RecogniserFinding[];
  trustBoundaryEvents: TrustBoundaryEvent[];
  delegatedExecutionEvent?: DelegatedExecutionEvent;
  timeline: TrustBoundaryTimelineEvent[];
  riskScore?: RiskScore;
  detectedCapabilities: string[];
  trustBoundaryCrossings: string[];
  causalRefs: CausalRef[];
}

export interface PageWorldObservedPayload {
  api: InitiatingApi;
  url: string;
  method?: string;
  timestamp?: string;
  pageUrl: string;
  initiatorLocation?: string;
  bodyLength?: number;
  payloadSample?: string;
}

export interface PageWorldObservedEventMessage {
  source: "wireshadow-page";
  type: "wireshadow-observed-event";
  payload: PageWorldObservedPayload;
}

export interface RuntimeObservedEventMessage {
  type: "wireshadow-observed-event";
  payload: PageWorldObservedPayload;
}

export interface PanelGetEventsMessage {
  type: "wireshadow-panel-get-events";
  tabId?: number;
}

export interface PanelEventsMessage {
  type: "wireshadow-panel-events";
  payload: {
    events: ObservedEvent[];
  };
}

export type ExtensionInboundMessage = RuntimeObservedEventMessage | PanelGetEventsMessage;
export type ExtensionOutboundMessage = PanelEventsMessage;
