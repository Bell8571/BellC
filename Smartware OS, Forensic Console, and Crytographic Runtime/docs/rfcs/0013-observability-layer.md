---
label: RFC:OBSERVABILITY-LAYER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0013"
title: "Implement Observability Layer — Local-First Traces, Metrics, Logs; Opt-In Export"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 2
milestone: "M2.6"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0013 — Observability Layer + Phase 2 GA

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 2 — Distributed Fabric
> **Milestone:** M2.6 — Observability Layer + Phase 2 GA (May 2028)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Local-only mode is the DEFAULT.
2. External export MUST be opt-in with customer-configured endpoint.
3. No hardcoded SaaS telemetry URLs. No phone-home.
4. OTel-compatible span/metric shapes; not a full OTLP SDK fork.
5. M2.6 acceptance alone did not clear Phase 2 → Phase 3;
   that gate was cleared separately by DRI on 2026-09-09.
```

---

## § 1 — Summary

Ship an in-process observability facade: spans, counters/histograms, and structured log records buffered locally. Export to an external URL only when `export.enabled === true` and `export.endpoint` is set by the operator.

---

## § 2 — Design

### 2.1 Local store (default)

Ring buffers for spans, metrics, and logs. `snapshot()` returns current buffers for inspect/CLI.

### 2.2 Export (opt-in)

```typescript
interface ExportConfig {
  enabled: boolean; // default false
  endpoint?: string; // required when enabled
}
```

When enabled without endpoint → fail-closed (refuse start).

### 2.3 API

- `startSpan(name, attrs?)` / `endSpan(spanId, status?)`
- `incr(name, value?, attrs?)` / `observe(name, value, attrs?)`
- `log(level, message, attrs?)`
- `snapshot()` / `flushExport()` (no-op unless export enabled)

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("next"). Linked to M2.6.
  Sign-off directed by the DRI; agent recorded the entry.
2026-09-09 | Bell Corporate Labs | Phase 2 → Phase 3 gate cleared
  Directed in session ("clear phase 2"). Consensus review accepted
  under gate clearance. Phase 3 scaffolding authorised.
```

---

*Bell Corporate Labs · RFC-0013 · M2.6*
