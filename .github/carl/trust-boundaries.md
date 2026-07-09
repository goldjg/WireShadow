<!-- version: 1.0.0 -->
# Trust Boundaries

## Boundary model

| Boundary | Source | Trust level | Required validation |
|---|---|---|---|
| Browser page context | DOM + page-world JavaScript | Medium | Treat content as untrusted; classify and redact before retention |
| Extension context | MV3 content script + background | Medium-high | Accept only expected message schema; avoid payload over-collection |
| SaaS control plane | Trusted SaaS endpoint in browser network tab | Medium | Do not assume this reflects downstream delegated runtime behavior |
| Delegated runtime | Provider-managed compute (e.g. Colab runtime) | Low visibility | Model as hidden-egress risk; infer intent from browser-observed code and metadata |
| External destinations | Outbound targets referenced by code | Low | Do not trust destination intent; classify risk semantics |
| Governance authority | `.github/carl/*` | High | Canonical governance truth for planning, execution, and reconciliation |

## Crossing rules

1. Page-world to extension messages are metadata-only in bootstrap.
2. Any candidate sensitive value must pass through classification and redaction before storage.
3. WireShadow Lite captures observability metadata, not full secrets or full payload dumps.
4. Delegated runtime behavior is represented as risk findings, not simulated exfiltration.
5. Canonical cARL artefacts outrank adapters and prompt/session memory.

## Trust-boundary events (event model contract)

- `browser -> saas-control-plane` (user/browser request intent)
- `saas-control-plane -> managed-runtime` (delegated execution transition)
- `managed-runtime -> external-egress` (potential hidden egress indicator)
