<!-- version: 1.4.0 -->
# Current PR Contract

## Goal
Implement session-scoped semantic correlation for delegated execution so WireShadow can correlate non-empty Colab/Jupyter execute_request calls with previously observed symbol capabilities and argument provenance, then produce evidence-scoped risk and trust-boundary findings without storing raw notebook code.

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
- Replace TypeScript-only extension emit with a bundling-based build that generates manifest-compatible runtime artifacts.
- Add a built-output extension smoke test that validates bridge readiness and end-to-end event flow.
- Support child-frame content script execution where host pages execute network calls in iframes.
- Detect Colab page/notebook indicators, notebook cell edits, notebook execution markers, executable Python cell creation, Markdown cell creation, and notebook metadata hints.
- Expand semantic pattern detection for networking libraries, external execution commands, GitHub targets, cloud storage targets, HTTP method intent, base64/blob markers, and token-like indicators.
- Introduce a generic `DelegatedExecutionEvent` model with platform, confidence, trigger, language, outbound capability, embedded data, and trust-boundary-crossed fields.
- Generate structured trust-boundary timeline events.
- Add deterministic additive risk scoring with explicit contributing factors.
- Extend popup UI to show recogniser, timeline, score, capabilities, and trust-boundary crossings.
- Add focused tests for recogniser behavior, delegated event generation, timeline generation, risk scoring, redaction safety, and integration.
- Add session-scoped semantic state correlation across notebook executions (imports, function definitions, assignments, calls, argument provenance).
- Add explicit evidence levels (observed/correlated/inferred/unknown) to semantic findings.
- Correlate later symbol invocation with prior function capabilities and destination metadata.
- Keep generic correlation logic in shared core semantic analysis; keep Colab recogniser platform-specific.
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
- Live-frame protocol shape finding: outbound kernel frames may arrive as direct JSON, array-wrapped payloads, nested envelopes, stringified nested JSON, and prefixed transport frames before the JSON payload.
- WebSocket semantic approach: bounded protocol-aware extraction now supports direct/nested/array/stringified/prefixed JSON and frame-encoding metadata (`text`, `arraybuffer`, `typed-array`, `blob`); only non-empty `execute_request.content.code` contributes execution semantics.
- Empty `execute_request` messages are now protocol observations only: they increment protocol counters, do not overwrite the latest meaningful execution event, do not create delegated execution findings, and do not add risk score.
- Risk flags are now evidence-gated: `delegated-execution`/`code-execution` require non-empty execution, `hidden-egress` requires outbound capability in executed code, `embedded-data` requires embedded-data detection, and `sensitive-pattern` requires concrete sensitive classifier categories.
- Runtime/session metadata exclusions were added for token-like detection (runtime host/session/kernel/notebook transport metadata) so routine Colab metadata is not treated as user-secret exposure.
- Correlation root cause: single execute_request inspection missed distributed notebook meaning where outbound capabilities are defined in earlier cells and invoked later.
- Correlation fix: added bounded session-scoped semantic state keyed by hashed runtime context (tab/notebook/kernel), tracking imports, aliases, functions, assignments, and calls with expiry and bounded symbol limits.
- Additional correlation root cause: semantic context keys included frame IDs, fragmenting same tab/kernel/notebook meaning across frame boundaries.
- Additional correlation root cause: call parsing only matched line-start call shapes and missed assignment-wrapped multiline calls.
- Additional correlation fix: semantic context key normalized to tab+kernel+notebook hash (frame-agnostic), and call parser now supports assignment-wrapped multiline invocations.
- Additional correlation diagnostics: execution metadata now records statement kinds, semantic-store size before/after, resolution result, and redacted failure taxonomy without retaining raw code.
- New ingestion root cause: semantic analysis previously depended on truncated payload samples for WebSocket frames, causing larger valid execute_request envelopes to fail parsing and skip definition/assignment ingestion.
- New ingestion fix: WebSocket path now separates semantic input from display sample, parsing complete bounded frame text before truncation and emitting redacted diagnostics-only metadata.
- New limits: bounded frame parse size, bounded code-analysis size, bounded nested decode depth, bounded parser node/depth traversal, and bounded semantic-fact emission counters.
- Function-definition root cause: the generic parser only matched single-line `def ...(...):` headers, so decorated or multiline signatures were analysed as code but never persisted as function symbols.
- Function-definition fix: generic semantic parser now recognises decorated + multiline `def`/`async def` signatures, extracts bounded function metadata, persists symbols deterministically, and surfaces function-store insertion diagnostics.
- Evidence model added for semantic reporting: observed, correlated, inferred, and unknown.
- Correlated execution findings now include known symbol invoked, inherited capabilities, argument provenance, and explicit downstream activity status `unknown`.
- Generic/shared logic extracted into core semantic layer (`python-semantic`) so service-specific recogniser logic remains platform attribution only.
- Build-system root cause: MV3 content scripts cannot execute unresolved ESM imports, and `tsc` emit left top-level imports in `content-script.js`, causing startup failure.
- Build-system change: `npm run build` now runs `tsc --noEmit` and `scripts/build-extension.mjs` (esbuild), producing unpacked extension output in `dist/extension`.
- Popup root cause: MV3 extension pages block inline JavaScript by default CSP, so popup logic embedded in `panel/index.html` did not execute.
- Popup build change: popup logic moved to `src/extension/panel/panel.ts`, bundled to `dist/extension/panel/panel.js`, and loaded via external script reference.
- Smoke-test evidence: Playwright extension smoke test runs against built output (`dist/extension`), checks bridge/page-ready status, triggers fetch, verifies event ingestion, and fails on page/console errors (opt-in `WIRESHADOW_E2E=1`).
- Validation evidence in this session:
  - `npm run build`: passed.
  - `npm test`: blocked by local runtime mismatch (`node:util styleText` export missing in current Node runtime).
  - `carl harness sync`, `carl map`, `carl doctor`: blocked because `carl` CLI is unavailable in the execution environment.
- Remaining Colab-specific limitation: live Colab browser validation and per-frame de-duplication tuning remain follow-on tasks; manual Colab revalidation was not executable in this environment.

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
