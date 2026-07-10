# WireShadow Memory

## Product
WireShadow

## Purpose
Browser-side observability for delegated execution and hidden egress risk.

## Research origin
SPADE (Side-channel Platform Abuse and Data Exfiltration), with Google Colab as the initial scenario.

## MVP
Chromium MV3 extension (WireShadow Lite) with safe metadata-only instrumentation.

### WireShadow Lite observability surfaces
- Outbound destination metadata
- Initiating browser APIs: `fetch`, XHR, `sendBeacon`, `WebSocket`, `EventSource`
- Initiating script context where observable
- Request metadata
- High-level payload classification
- SPADE recogniser findings
- Delegated execution event modelling (`DelegatedExecutionEvent`)
- Trust Boundary Timeline generation
- Deterministic additive risk scoring with explicit factors

### Browser observation pipeline architecture
- Authoritative event source of truth is the background service worker typed in-memory store.
- Flow is: Page World -> Content Script -> Background Service Worker -> View Models -> Popup.
- UI surfaces are read-only consumers over the same typed event stream.
- Current UI surface is popup; dedicated DevTools panel is deferred to a future PR.
- External page-world script injection must wait for load/error before removal; immediate removal after append can race async execution and suppress instrumentation.
- Instrumentation state should be explicit via typed readiness/status messages so "no events" is distinguishable from probe-load failure.
- Child-frame execution can matter for Colab traffic patterns; all-frame instrumentation is baseline with future frame de-duplication hardening.
- HAR-derived protocol finding: delegated execution intent in Colab is primarily surfaced via outbound Jupyter kernel WebSocket frames (`execute_request`) on `/api/kernels/<id>/channels`.
- Colab LSP WebSocket messages (`textDocument/didOpen` / `didChange`) are notebook-content/edit signals only and should not independently trigger execution semantics.
- Drive autosave multipart PUT requests are secondary notebook-content evidence, not primary execution trigger.

### First semantic recogniser (Google Colab)
- Colab recogniser passively detects notebook document markers, notebook edit signals, cell-type indicators, and execution intent markers.
- Semantic capability classification includes Python networking, external execution helpers, GitHub targets, cloud-storage targets, HTTP method intent, and embedded data/token-like markers.
- The recogniser models SaaS control-plane to managed-runtime boundary crossing and potential hidden downstream egress risk.

## Future
CDP-powered WireShadow Pro assessment capabilities (documentation-only in bootstrap).

### WireShadow Pro potential capabilities
- Request/response inspection
- Runtime call stacks and source maps
- Dynamic script creation and service worker visibility
- Storage and DOM mutation tracking
- Notebook/workflow execution semantics
- Trust-boundary timelines
- Causal execution graphs

## Principles
- Classify and redact sensitive values by default.
- Prove visibility without extracting secrets.
- Keep bootstrap implementation intentionally lightweight.

## Non-goals
- Credential theft
- Platform-protection bypassing
- Offensive automation
- Malware behavior
- Real exfiltration
