---
label: RFC:SERVERLESS-DAG-RUNTIME-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0015"
title: "Implement Serverless DAG Execution Beta — Runtime Abstraction, Scale-to-Zero, Cold-Start Budget"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.2"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0015 — Serverless DAG Execution Beta

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.2 — Serverless DAG Execution Beta (Oct 2028)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Runtime abstraction MUST support container | wasm | inprocess.
2. Scale-to-zero is the default (maxWarmInstances defaults to 0 until demand).
3. Metering/billing hooks MUST default OFF (Authority-0 Phase 3).
4. No phone-home. Cold-start budget tracked locally (target P99 < 500ms).
5. Do not scaffold M3.3 portal until directed.
6. Real OCI/WASM engines may be stubbed; the adapter contract is normative.
```

---

## § 1 — Summary

Introduce a **ServerlessRuntime** that pools ephemeral executors behind a kind-agnostic adapter (`inprocess` | `container` | `wasm`), scales to zero after idle TTL, records cold-start latency against a 500ms budget, and optionally accumulates local metering events only when `meteringEnabled === true`.

---

## § 2 — Design

### 2.1 Adapter

```typescript
interface RuntimeAdapter {
  kind: "inprocess" | "container" | "wasm";
  warm(): Promise<{ instanceId: string }>;
  invoke(instanceId: string, payload: unknown, signal: AbortSignal): Promise<{ output?: unknown }>;
  dispose(instanceId: string): Promise<void>;
}
```

### 2.2 Scale-to-zero

- Idle instances past `idleTtlMs` are disposed.
- `scaleToZero()` drains all non-busy instances immediately.
- Default pool starts empty (cold).

### 2.3 Invoke path

`invoke` reuses a warm idle instance or cold-starts one, marks busy → warm, returns `{ coldStart, durationMs, instanceId, output }`.

### 2.4 Out of scope

- Developer portal (M3.3)
- Multi-region routing (M3.4)
- Production containerd/wasmtime embedding (adapter stubs OK for beta)

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("next"). Linked to M3.2.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0015 · M3.2*
