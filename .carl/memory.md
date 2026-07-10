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
- Live Colab kernel frames can be wrapped as nested envelopes, arrays, stringified JSON, or prefixed transport payloads; recogniser parsing must be bounded, recursive, and protocol-aware to recover Jupyter `execute_request` safely.
- Empty `execute_request.content.code` is protocol telemetry only and must not overwrite the latest meaningful semantic execution event.
- Semantic risk flags should be evidence-gated from correlated non-empty execution events; ordinary Colab page traffic alone should not generate delegated-execution flags.
- Token-like classifier heuristics need context-aware exclusions for Colab/runtime transport metadata (runtime host/session/kernel/notebook IDs) to reduce false secret classification.
- Notebook semantics are distributed across executions; single-cell execute_request analysis is insufficient for outbound-risk attribution.
- Session-scoped semantic correlation should track imports, aliases, function definitions, assignments, and calls keyed by hashed runtime context (tab/notebook/kernel) with bounded size and expiry; including frame IDs can fragment same-notebook sessions.
- Call parsing for semantic correlation must support assignment-wrapped multiline call shapes (for example `result = upload_to_github(...)`) so later invocations resolve against previously observed symbols.
- Resolution diagnostics should use explicit taxonomy (`definition-not-seen`, `session-mismatch`, `parser-failed`, `unsupported-call-shape`, `state-expired`, `state-reset`, etc.) and remain metadata-only.
- Correlated semantic findings should carry explicit evidence levels: observed, correlated, inferred, unknown.
- Generic semantic analysis (symbol capability mapping, argument provenance, call resolution) belongs in shared core layers; recognisers should keep only service-specific attribution and protocol quirks.
- Semantic parsing must consume complete bounded WebSocket frame text before any display-sample truncation.
- Display samples are telemetry-only; semantic analysis input and persistent storage remain redacted metadata only.
- Generic function-definition extraction must support decorated/multiline `def` and `async def` signatures; otherwise function symbols can be missing while other semantic counters increase.
- Function-stage diagnostics should separate parser recognition, semantic-fact creation, and symbol-store insertion outcomes.
- **Diagnostic overwrite pattern**: any state field updated unconditionally with `optionalValue?.field ?? fallback` on every WebSocket frame will reset to `fallback` whenever that optional is undefined (e.g. non-execution background frames). Fields derived from a per-frame optional must only update inside a guard confirming that optional is defined.
- Drive autosave multipart PUT requests are secondary notebook-content evidence, not primary execution trigger.
- MV3 content scripts require bundle-safe script output; TypeScript-only emit can leave unresolved imports that prevent content script startup.
- Canonical built extension directory is `dist/extension`, produced by typecheck + esbuild bundling plus static asset copy.
- Build guard: bundling pipeline verifies `dist/extension/content-script.js` and `dist/extension/page-world.js` parse as classic scripts (no top-level module syntax).
- MV3 popup pages also require external scripts under default CSP; popup runtime logic must be bundled into `panel/panel.js` and referenced from HTML, not inlined.

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
