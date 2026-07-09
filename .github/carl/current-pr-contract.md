<!-- version: 1.1.0 -->
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
- `src/extension/panel/index.html`
- `tests/**`

## Tests / validation
- `npm run build`
- `npm test`
- `carl harness sync`
- `carl map`
- `carl doctor`

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
