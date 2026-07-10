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
- Drive multipart autosave requests may contain notebook content but should remain secondary evidence relative to kernel WebSocket execution messages.

## Canonical validation commands
- `npm run build`
- `npm test`
- `carl harness sync`
- `carl map`
- `carl doctor`
