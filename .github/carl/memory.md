<!-- version: 1.0.0 -->
# Durable Architectural Truth Cache

## Project purpose
WireShadow is a browser security and research tool that reveals delegated execution intent and hidden egress risk not visible in standard browser network inspection.

## Research origin
WireShadow originated from SPADE research (**Side-channel Platform Abuse and Data Exfiltration**) with Google Colab as the first poster-child scenario.

## Product split
- **WireShadow Lite**: Chromium MV3 extension focused on metadata-level observation and safe classification/redaction.
- **WireShadow Pro (future)**: CDP-backed assessment capabilities (documented only in bootstrap).

### WireShadow Lite observability surfaces
- outbound destinations
- initiating APIs (`fetch`, XHR, `sendBeacon`, WebSocket, EventSource, form submission)
- page/frame execution context
- request metadata
- high-level payload classification
- SPADE recogniser findings
- delegated execution event modelling (`DelegatedExecutionEvent`)
- trust-boundary timeline generation
- deterministic additive risk scoring with explicit factors

### WireShadow Pro candidate capabilities (documented only)
- request and response inspection
- call stacks and source maps
- dynamic script creation
- service worker visibility
- storage changes and DOM mutations
- notebook/workflow execution semantics
- trust-boundary timelines
- causal execution graphs

## Durable safety principles
- Redact and classify by default.
- Never retain full secret material.
- Retain only category, length, hash, and minimal safe evidence.
- Prove visibility without extracting secrets.

## Explicit non-goals
- Credential theft.
- Bypassing platform protections.
- Offensive automation.
- Malware-like behavior.
- Real exfiltration functionality.

## Architecture summary
- `src/extension/`: MV3 instrumentation stubs (background, content, page-world, panel).
- `src/core/`: event model, classifier, redaction, semantic scoring/timeline, shared types.
- `src/recognisers/`: platform recognisers (Google Colab first).
- `tests/`: focused classifier and recogniser tests.

## Colab semantic recogniser baseline
- Recogniser passively detects notebook document, cell edit, cell type, metadata, and execution intent signals.
- Capability detection includes networking libraries, external execution helpers, GitHub targets, cloud-storage targets, HTTP method intent, and embedded data/token-like markers.
- Trust-boundary crossing is represented with structured timeline events to explain managed-runtime egress risk outside browser-only visibility.

## Trust-boundary framing
- Browser UI and JavaScript runtime are distinct from delegated provider-managed execution environments.
- Browser-observed intent does not equal observed downstream runtime egress.
- WireShadow surfaces intent markers and risk semantics at the browser-side boundary.

## Durable field findings
- External page-world script injection must be load/event-driven; removing the script node immediately after append can race async execution and silently disable instrumentation.
- Instrumentation health requires explicit typed handshake (`wireshadow-page-ready`) plus runtime status propagation, otherwise "no events" cannot be distinguished from probe-load failure.
- Colab can execute network activity from child frames; baseline instrumentation should run in all frames, with frame-aware de-duplication as a follow-on refinement.
- HAR-derived Colab protocol truth: delegated execution intent is primarily visible in outbound Jupyter kernel WebSocket frames (`execute_request` on `/api/kernels/<id>/channels`), not only in fetch/XHR.
- Colab LSP WebSocket traffic (`textDocument/didOpen`/`didChange` on `/colab/lsp`) is useful as notebook-content/edit signal but must not be treated as execution trigger.
- Live Colab kernel frames can be wrapped as nested envelopes, arrays, stringified JSON, or prefixed transport payloads; recogniser parsing must be bounded, recursive, and protocol-aware to recover Jupyter `execute_request` safely.
- Empty `execute_request.content.code` is protocol telemetry only and must not overwrite the latest meaningful semantic execution event.
- Semantic risk flags should be strictly evidence-gated from correlated non-empty execution events; ordinary Colab page traffic alone should not produce delegated-execution flags.
- Token-like classifier heuristics need context-aware exclusions for Colab/runtime transport metadata (runtime host/session/kernel/notebook IDs) to avoid false secret classification.
- Notebook semantics are distributed across executions; single-cell execute_request analysis is insufficient for outbound-risk attribution.
- Session-scoped semantic correlation should track imports, aliases, function definitions, assignments, and calls keyed by hashed runtime context (tab/notebook/kernel) with bounded size and expiry; frame-id inclusion can fragment same-notebook sessions.
- Call parsing for semantic correlation must support assignment-wrapped multiline call shapes (for example `result = upload_to_github(...)`) so later invocations resolve to previously observed symbols.
- Resolution diagnostics should use explicit taxonomy (`definition-not-seen`, `session-mismatch`, `parser-failed`, `unsupported-call-shape`, `state-expired`, `state-reset`, etc.) and remain redacted metadata-only.
- Correlated semantic findings should carry explicit evidence levels: observed, correlated, inferred, unknown.
- Generic semantic analysis (symbol capability mapping, argument provenance, call resolution) belongs in shared core layers; recognisers should keep only service-specific attribution and protocol quirks.
- Semantic parsing must use complete bounded WebSocket frame text first, then derive a separate truncated display sample; display truncation must never be the semantic-analysis source.
- Safe semantic diagnostics should track parse/extraction/analysis counters and bounded failure reasons without storing raw frame/code content.
- Generic function-definition extraction must handle decorated and multiline signatures (including async) or semantic state will show assignments/calls without persisted functions.
- Function persistence diagnostics should distinguish parser recognition, semantic fact emission, and symbol-store insertion outcomes to isolate definition-not-seen root causes.
- Drive multipart autosave requests may contain notebook content but should remain secondary evidence relative to kernel WebSocket execution messages.
- MV3 content scripts must be delivered as classic script bundles; unresolved top-level imports in compiled content script output prevent startup.
- Canonical unpacked extension output directory is `dist/extension`, built via `tsc --noEmit` + esbuild bundling + static asset copy.
- Build pipeline verifies `dist/extension/content-script.js` and `dist/extension/page-world.js` parse as classic scripts to prevent module-syntax regressions.
- MV3 popup pages run under CSP that blocks inline JavaScript; popup runtime logic must be externalized and bundled as `panel/panel.js`.

## Canonical validation commands
- `npm run build`
- `npm test`
- `carl harness sync`
- `carl map`
- `carl doctor`
