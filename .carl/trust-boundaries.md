# WireShadow Trust Boundaries

## Core boundaries

1. Browser page context (untrusted content and script surface)
2. Extension runtime (content/background messaging boundary)
3. SaaS control plane (trusted endpoint visibility surface)
4. Delegated execution runtime (provider-managed compute outside endpoint visibility)
5. External egress destinations (potential hidden outbound data paths)

## Boundary rules

- Observe metadata safely; do not collect full sensitive payloads.
- Use classifier + redaction before retaining evidence.
- Represent delegated execution as semantic risk signals.
- Treat managed-runtime to external-egress as potential/inferred only in Lite mode; downstream observed status remains unknown.
- Keep no implementation that performs or assists exfiltration.
- Allow transient in-memory full-frame/code parsing only within bounded limits; retain and emit redacted metadata-only diagnostics.
