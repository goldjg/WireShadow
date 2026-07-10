# WireShadow Colab Semantic Recogniser PR Contract

## Goal
Implement the first semantic recogniser for Google Colab to surface delegated execution risk, trust-boundary crossings, timeline evidence, and deterministic scoring without parsing notebooks or interfering with execution.

## Contract status
active

## Non-goals
- Full notebook parsing or notebook behavior modification.
- Persistence, filtering, export, AI summarization, or remote telemetry.
- DevTools panel implementation in this PR.
- Any offensive or exfiltration behavior.
- Retaining raw payload or secret values.

## Approved scope
- Preserve the existing passive instrumentation pipeline and extend it with Colab semantic analysis.
- Fix deterministic page-world injection timing and guard against duplicate injection.
- Add typed page-ready/runtime status handshake so instrumentation health is observable.
- Add popup diagnostics for instrumentation status, bridge state, event count, and tab support.
- Add WebSocket outbound frame observation with typed message variants and bounded frame metadata.
- Add Jupyter protocol recognition for kernel `execute_request` semantics and LSP edit-only signals.
- Treat Drive multipart autosave as secondary evidence, not execution trigger.
- Include all-frame content script execution support for child-frame network activity.
- Recognise Colab page, notebook document indicators, notebook cell edits, notebook execution, executable Python cell creation, Markdown cell creation, and notebook metadata hints.
- Expand semantic classifier patterns for Python networking, external execution, GitHub, cloud storage, HTTP method intent, embedded blobs/base64, and secret-like markers.
- Introduce a generic `DelegatedExecutionEvent` model including platform, confidence, trigger, execution language, outbound capability, embedded data, and trust-boundary crossing.
- Generate a deterministic Trust Boundary Timeline as structured events.
- Add lightweight additive risk scoring with explicit contributing factors.
- Extend popup to display recogniser, timeline, score, detected capabilities, and trust-boundary crossings.
- Add focused tests for recogniser behavior, timeline/scoring, delegated execution event generation, redaction guarantees, and integration.
- Update README and required cARL mirrors (`.carl/current-pr-contract.md`, `.carl/repo-map.json`, `.carl/memory.md`).

## Forbidden scope
- Raw payload retention.
- Secret exposure in UI, logs, or stored event records.
- Active interference with notebook behavior or execution.
- CI/CD, infrastructure, or unrelated governance rewrites.

## Architectural constraints
- Background service worker typed event store is source of truth.
- UI surfaces are read-only consumers over the same typed event stream.
- Keep instrumentation lightweight and avoid duplicate events.
- Keep semantic event model generic for future recognisers.

## Security constraints
- Always classify/redact before retention.
- Store metadata + redacted evidence only.
- Never store raw secret values.

## Files expected to change
- `src/core/types.ts`
- `src/core/events.ts`
- `src/core/classifier.ts`
- `src/core/semantic.ts`
- `src/recognisers/colab.ts`
- `src/extension/background.ts`
- `src/extension/content-script.ts`
- `src/extension/contracts.ts`
- `src/extension/page-world.ts`
- `src/extension/manifest.json`
- `src/extension/panel/index.html`
- `tests/*.test.ts`
- `README.md`
- `.github/carl/current-pr-contract.md`
- `.carl/current-pr-contract.md`
- `.carl/repo-map.json`
- `.carl/memory.md`

## Validation commands
- `npm test`
- `npm run build`
- `carl harness sync`
- `carl map`
- `carl doctor`

## Field root cause and evidence
- Root cause: `src/extension/content-script.ts` removed injected `page-world.js` immediately after append, risking cancellation before async external script execution.
- HAR-derived protocol finding: Colab execution requests are observed over kernel channel WebSocket frames (`/api/kernels/<id>/channels`) and notebook-edit signals over Colab LSP WebSocket frames (`/colab/lsp`); Drive autosave PUT bodies are secondary evidence only.
- Evidence: `npm run build` passes with deterministic extension bundle output; `npm test` is blocked by local Node runtime mismatch for Vitest startup (`node:util styleText` export); `carl` commands are blocked because CLI is unavailable in this environment.
- Remaining Colab limitation: live interactive Colab validation and frame-aware de-duplication heuristics remain future hardening work.
