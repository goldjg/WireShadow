<!-- version: 1.3.0 -->
# Current PR Contract

## Goal
Implement the first semantic recogniser for Google Colab so WireShadow can explain delegated execution risk, produce trust-boundary timelines, and surface deterministic risk factors without parsing notebooks or interfering with execution.

## Contract status
active

## Non-goals
- Full notebook parsing or notebook behavior modification.
- Persistence, filtering/search, export, AI summarisation, or remote telemetry.
- DevTools panel implementation in this PR.
- Any offensive automation, credential theft, malware behavior, or real exfiltration functionality.
- Capturing or storing full secret values.

## Carry-forward rules
- cARL artefacts under `.github/carl/` remain canonical governance authority.
- `.carl/` files are compatibility mirrors and should remain consistent with this contract.
- Redaction-by-default and no-secret-retention remain durable invariants.

## Approved scope
- Extend the existing passive extension pipeline with Colab semantic recogniser outputs.
- Fix deterministic page-world probe injection so external script removal never races async execution.
- Add typed page-world readiness handshake and background-recorded instrumentation status.
- Add popup diagnostic sensor state for instrumentation/bridge/observer/tab support/event counts.
- Add WebSocket outbound frame observation and typed frame events for Colab kernel/lsp channels.
- Add Jupyter protocol semantic recognition for `execute_request` and LSP edit signals.
- Treat Drive multipart autosave as secondary evidence, not execution trigger.
- Support child-frame content script execution where host pages execute network calls in iframes.
- Detect Colab page/notebook indicators, notebook cell edits, notebook execution markers, executable Python cell creation, Markdown cell creation, and notebook metadata hints.
- Expand semantic pattern detection for networking libraries, external execution commands, GitHub targets, cloud storage targets, HTTP method intent, base64/blob markers, and token-like indicators.
- Introduce a generic `DelegatedExecutionEvent` model with platform, confidence, trigger, language, outbound capability, embedded data, and trust-boundary-crossed fields.
- Generate structured trust-boundary timeline events.
- Add deterministic additive risk scoring with explicit contributing factors.
- Extend popup UI to show recogniser, timeline, score, capabilities, and trust-boundary crossings.
- Add focused tests for recogniser behavior, delegated event generation, timeline generation, risk scoring, redaction safety, and integration.
- Update README and required cARL mirror artefacts.

## Forbidden scope
- Any functionality that blocks, mutates, or interferes with notebook execution behavior.
- Any functionality that transmits captured data to third parties.
- Any persistence of full token, credential, key, or secret payload values.
- Any unrelated CI/CD, infrastructure, or governance rewrites outside required cARL reconciliation.

## Architectural constraints
- Keep implementation modular: recogniser semantics in recogniser/core modules; ingestion in background; display in popup.
- Preserve the existing background service worker as authoritative event source.
- Keep event models generic enough for future recognisers.
- Preserve strict typing and avoid `any` at public boundaries.

## Security constraints
- Redact by default; retain category, length, hash, and minimal safe evidence only.
- Treat browser-to-SaaS and SaaS-to-managed-runtime as explicit trust boundaries.
- Keep the implementation passive and deterministic.

## Files expected to change
- `.github/carl/current-pr-contract.md`
- `.carl/current-pr-contract.md`
- `.carl/repo-map.json`
- `.carl/memory.md`
- `README.md`
- `src/core/**`
- `src/recognisers/**`
- `src/extension/background.ts`
- `src/extension/content-script.ts`
- `src/extension/contracts.ts`
- `src/extension/page-world.ts`
- `src/extension/manifest.json`
- `src/extension/panel/index.html`
- `tests/**`

## Tests / validation
- `npm run build`
- `npm test`
- `carl harness sync`
- `carl map`
- `carl doctor`

## Field root cause and evidence
- Root cause: `content-script.ts` appended `page-world.js` then removed the element immediately, creating a race where async external script execution could be cancelled before probe installation.
- Fix approach: script now remains attached until `load`/`error`, uses durable DOM marker guards, and emits typed status updates (`wireshadow-page-ready` handshake + runtime content status).
- HAR-derived protocol finding: Colab delegated execution is primarily emitted over Jupyter kernel WebSocket frames (`/api/kernels/<id>/channels`) with outbound `execute_request` messages, while LSP WebSocket messages (`/colab/lsp`) provide notebook-content/edit signals. Drive multipart autosave is treated as secondary evidence.
- WebSocket semantic approach: outbound `WebSocket.send()` frames are observed with bounded metadata, JSON-safe parsing is applied for text frames, and only non-empty `execute_request` code contributes execution semantics.
- Validation evidence in this session:
  - `npm run build`: passed.
  - `npm test`: blocked by local runtime mismatch (`node:util styleText` export missing in current Node runtime).
  - `carl harness sync`, `carl map`, `carl doctor`: blocked because `carl` CLI is unavailable in the execution environment.
- Remaining Colab-specific limitation: live Colab browser validation and per-frame de-duplication tuning remain follow-on tasks; this environment cannot execute interactive extension validation against live Colab.

## Stop conditions
- Requested behavior requires active interference with notebook/runtime behavior.
- Any proposed change violates redaction/no-secret-retention invariants.
- Required validation commands fail and cannot be resolved within scope.

## Escalation triggers
- Need to add dependencies beyond the existing TypeScript + Vitest stack.
- Need to alter harness authority semantics.
- Need to broaden scope beyond Colab semantic recogniser + passive UI/reporting updates.

## Context reset notes
After completion, close or supersede this contract in the next PR cycle.
