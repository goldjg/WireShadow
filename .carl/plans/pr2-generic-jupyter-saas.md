<!-- version: 1.0.0 -->
# Generic Jupyter SaaS Recognition

## Goal
Extend WireShadow's existing Colab-only Jupyter observation into a reusable,
evidence-gated Jupyter SaaS path, with Google Colab and Kaggle as explicit
platform attributions.

## Affected files
- `.github/carl/current-pr-contract.md` and compatibility mirror
- `.github/carl/memory.md` and compatibility mirror when durable findings change
- `README.md`
- `src/core/**`
- `src/recognisers/**`
- `src/extension/background.ts`
- `tests/**`

## Contract assertions
1. A non-empty outbound Jupyter `execute_request` on a recognised Colab or
   Kaggle notebook/runtime surface produces delegated-execution evidence with
   the correct platform attribution.
2. Site presence, ordinary page traffic, empty execution messages, and
   non-execution Jupyter messages never create delegated-execution or
   hidden-egress flags.
3. Raw frame/code content is processed only within existing bounds and is not
   retained; stored events contain length/hash/redacted evidence only.
4. Existing Colab protocol shapes and semantic correlation continue to work.
5. Unknown Jupyter deployments remain explicitly `unknown` rather than being
   mislabeled as Colab or Kaggle.

## Step-by-step changes
1. Amend the active PR contract to cover generic Jupyter protocol recognition
   and Kaggle attribution while preserving passive, redacted observation.
2. Extract bounded Jupyter envelope parsing from the Colab recogniser into a
   shared core module.
3. Add platform attribution from page/socket URLs and pass it through the
   delegated event, timeline, findings, and background ingestion path.
4. Add focused unit/integration fixtures for Kaggle, unknown Jupyter, negative
   evidence gates, and Colab regression behavior.
5. Build and run tests in a pinned ARM64 Node/Playwright container. Every
   browser/E2E asserted UI state must emit a retained screenshot under
   `docs/test-evidence/`.
6. Reconcile README and durable cARL memory with validated behavior only.

## Test strategy
- Unit tests for platform attribution and URL false positives.
- Protocol tests for non-empty, empty, malformed, and non-execution frames.
- Background/integration tests for event platform, flags, redaction, and
  diagnostics.
- `npm run build` and `npm test` in an ARM64 container.
- `WIRESHADOW_E2E=1 npm test` in the pinned ARM64 Playwright container; the run
  is incomplete unless asserted UI states have screenshot evidence under
  `docs/test-evidence/` and those paths are included in the handoff.
- `carl harness sync`, `carl map`, and `carl doctor` when the CLI is available.

## Risks
- Kaggle's browser transport can change independently of the Jupyter standard;
  attribution must depend on observed URL evidence and keep unknown fallback.
- Over-broad socket matching could misclassify arbitrary WebSockets; require a
  kernel-channel path plus a parseable Jupyter envelope.
- Browser smoke tests cannot prove provider-side egress and must not claim it.

## cARL/docs expectation
Update the active contract and mirrors before implementation. Update durable
memory and README only for behavior validated by tests or direct field evidence.
