# WireShadow Colab Semantic Recogniser PR Contract

## Goal
Implement session-scoped semantic correlation for delegated execution so WireShadow can correlate non-empty Colab/Jupyter execute_request calls with previously observed symbol capabilities and argument provenance, then produce evidence-scoped risk and trust-boundary findings without storing raw notebook code.

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
- Replace TypeScript-only extension emit with a bundling-based build that generates manifest-compatible runtime artifacts.
- Add a built-output extension smoke test that validates bridge readiness and end-to-end event flow.
- Include all-frame content script execution support for child-frame network activity.
- Recognise Colab page, notebook document indicators, notebook cell edits, notebook execution, executable Python cell creation, Markdown cell creation, and notebook metadata hints.
- Expand semantic classifier patterns for Python networking, external execution, GitHub, cloud storage, HTTP method intent, embedded blobs/base64, and secret-like markers.
- Introduce a generic `DelegatedExecutionEvent` model including platform, confidence, trigger, execution language, outbound capability, embedded data, and trust-boundary crossing.
- Generate a deterministic Trust Boundary Timeline as structured events.
- Add lightweight additive risk scoring with explicit contributing factors.
- Extend popup to display recogniser, timeline, score, detected capabilities, and trust-boundary crossings.
- Add focused tests for recogniser behavior, timeline/scoring, delegated execution event generation, redaction guarantees, and integration.
- Add session-scoped semantic state correlation across notebook executions (imports, function definitions, assignments, calls, argument provenance).
- Add explicit evidence levels (observed/correlated/inferred/unknown) to semantic findings.
- Correlate later symbol invocation with prior function capabilities and destination metadata.
- Keep generic correlation logic in shared core semantic analysis; keep Colab recogniser platform-specific.
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
- Live-frame protocol shape finding: outbound kernel frames may arrive as direct JSON, array-wrapped payloads, nested envelopes, stringified nested JSON, and prefixed transport frames before the JSON payload.
- WebSocket semantic extraction is now bounded and protocol-aware (direct/nested/array/stringified/prefixed JSON plus frame-encoding metadata), and only non-empty `execute_request.content.code` contributes execution semantics.
- Empty `execute_request` messages now remain protocol-only observations: they increment protocol counters, do not overwrite the latest meaningful execution event, do not generate delegated execution findings, and do not contribute risk score.
- Risk flags are now evidence-gated: `delegated-execution`/`code-execution` require non-empty execution, `hidden-egress` requires outbound capability in executed code, `embedded-data` requires embedded-data detection, and `sensitive-pattern` requires concrete sensitive classifier categories.
- Runtime transport metadata exclusions were added so routine Colab runtime host/session/kernel/notebook identifiers are not treated as user-secret exposure.
- Correlation root cause: single execute_request inspection missed distributed notebook meaning where outbound capabilities are defined in earlier cells and invoked later.
- Correlation fix: added bounded session-scoped semantic state keyed by hashed runtime context (tab/notebook/kernel), tracking imports, aliases, functions, assignments, and calls with expiry and bounded symbol limits.
- Additional correlation root cause: semantic context keys included frame IDs, fragmenting same tab/kernel/notebook semantics across frames.
- Additional correlation root cause: call parsing only matched line-start call shapes and missed assignment-wrapped multiline invocations.
- Additional correlation fix: semantic context key now normalizes to tab+kernel+notebook hash (frame-agnostic), and call parser now supports assignment-wrapped multiline call shapes.
- Additional diagnostics: execution metadata now captures statement kinds, semantic-store size before/after, resolution result, and redacted failure taxonomy without raw code retention.
- New ingestion root cause: semantic analysis path depended on truncated WebSocket payload samples, so larger valid execute_request envelopes could fail parse and skip definition/assignment state ingestion.
- New ingestion fix: protocol-aware parsing now uses complete bounded frame text first; display sample truncation is telemetry-only and no longer semantic input.
- New limits: bounded frame parse size, bounded code-analysis size, bounded nested decode/parser traversal, and bounded semantic-fact emission counters.
- Function-definition root cause: generic parser matching was limited to single-line `def ...(...):` headers, so decorated/multiline function signatures were not persisted as symbols.
- Function-definition fix: generic parser now supports decorated and multiline `def`/`async def` signatures and records deterministic function-store insertion diagnostics.
- Evidence model added for semantic reporting: observed, correlated, inferred, and unknown.
- Correlated execution findings now include known symbol invoked, inherited capabilities, argument provenance, and explicit downstream activity status `unknown`.
- Generic/shared logic extracted into core semantic layer (`python-semantic`) so service-specific recogniser logic remains platform attribution only.
- Build-system root cause: MV3 content scripts cannot execute unresolved ESM imports, and `tsc` emit left top-level `import` statements in `content-script.js`, causing extension startup failure.
- Build-system change: `npm run build` now runs `tsc --noEmit` + esbuild bundling (`scripts/build-extension.mjs`) and emits unpacked extension runtime to `dist/extension`.
- Popup root cause: MV3 extension pages block inline JavaScript by default CSP, so popup logic embedded in `panel/index.html` did not execute.
- Popup build change: popup logic moved to `src/extension/panel/panel.ts`, bundled to `dist/extension/panel/panel.js`, and loaded via external `<script src="./panel.js"></script>`.
- Smoke-test evidence: built-output Playwright extension smoke test updated to use `dist/extension`, validate bridge readiness handshake, trigger fetch, and verify background store ingestion while failing on page/console errors (opt-in via `WIRESHADOW_E2E=1`).
- Validation evidence: `npm run build` passed in-session; `npm test` remains blocked by local Node/Vitest runtime mismatch (`node:util styleText` export); `carl` commands remain blocked because `carl` CLI is unavailable here.
- Manual Colab validation status: not executed in this environment (requires local interactive browser session with extension reload).
- Function-model drop root cause: in `background.ts`, `knownFunctionsCount`, `knownVariablesCount`, `knownSymbolsCount`, `latestFunctionDefined`, and `latestFunctionInvoked` were updated unconditionally on every WebSocket frame using `semanticExecution?.diagnostics... ?? 0`. Non-execution frames (heartbeats, kernel-status, LSP signals) have `semanticExecution = undefined`, causing these fields to reset to 0/undefined on every background frame arriving after a definition cell. This explained: FunctionDef nodes found: 3, Known functions: 0.
- Function-model drop fix: all five fields now update only inside the `if (semanticExecution)` guard; non-execution frames leave state unchanged.
- Cumulative function pipeline counters added: `functionExtractionAttempted/Succeeded/Failed`, `functionStoreInsertionAttemptedCount/SucceededCount/FailedCount`, `functionDroppedCount` in `SemanticExecutionSummary.diagnostics`, `TabObserverState`, and `ObserverDiagnostics`; wired through to popup display.
- `FunctionAnalysisFailureReason` taxonomy expanded to 21 variants matching full brief specification.
- 27 new test cases added for function-model invariants and regression coverage including zero-capabilities persistence, async/decorated/multiline/variadic forms, body-content variants, nested-function handling, store insertion accounting, redefinition semantics, symbol key stability, assignment-wrapped call resolution, capability inheritance, raw-body non-retention, and the primary regression (3 FunctionDef nodes → 3 store insertions → knownFunctionsCount = 3).
- **Live validation (context key fragmentation root cause confirmed):** After the function-store fix, live Colab session still showed resolution failure reason: definition-not-seen. Two distinct session hashes appeared (dev diagnostics vs overview) — confirmed by diagnostic dump. Root cause: Colab silently opened a second WebSocket connection with a new kernel UUID in the URL path. Definition cells ran on kernel connection A; invocation ran on kernel connection B. Context key `tab|kernel|notebook` produced different keys → definition-not-seen.
- **Context key fix:** Removed kernel UUID from semantic context key. New format: `tab:${tab}|notebook:${notebookHash}`. Definitions now persist across transport reconnects within the same runtime epoch. They do NOT persist across a true kernel restart (`kernelResetSignal = true`, Python state gone) or an undetected runtime replacement.
- **Runtime epoch tracker:** `extractKernelId` retained as a read-only diagnostic tracker (not part of context key). `TabObserverState.currentKernelId`, `kernelEpochChanges`, `lastKernelRestartAt` added. A new kernel UUID increments `kernelEpochChanges`; a `kernelResetSignal` also records `lastKernelRestartAt` and clears the notebook context. These flow through `ObserverDiagnostics` and are shown in the popup under "Runtime epoch" so transport reconnects, runtime replacements, and genuine kernel restarts remain distinguishable.
- **Architectural identity model:** Notebook identity (tab+notebook) is the durable semantic scope. Runtime epoch (kernel UUID / connection generation) is the session scope within it. Transport connections are ephemeral within an epoch. Tying the context key to the transport (latest WebSocket URL) was the identity fragmentation error — the "Boundary Goblin" pattern.
- **Secondary overwrite fixes (same session):** `currentSemanticSessionHash` moved inside `if (semanticExecution)` guard (was being overwritten by LSP frames with a kernel-absent context key). `latestResolutionFailureReason` guarded against reset to undefined on non-execution frames.
- **Tests (session key):** 5 tests total in `background-session-key.test.ts` — stable key across frames, no cross-notebook merge, kernel-reconnect merges context, LSP+kernel same key, cross-tab isolation.
