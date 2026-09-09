---
label: RFC:FAULT-TOLERANCE-MULTI-TENANCY-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0012"
title: "Implement Fault-Tolerant Execution and Multi-Tenancy — Failover, Checkpoints, RBAC, Namespace Quotas"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 2
milestone: "M2.5"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0012 — Fault-Tolerant Execution + Multi-Tenancy

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 2 — Distributed Fabric
> **Milestone:** M2.5 — Fault-Tolerant Execution + Multi-Tenancy (March 2028)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. RBAC schema is versioned from day one.
2. Namespace quotas enforced fail-closed (deny when exceeded).
3. Failover reassigns only placements on DEAD nodes; ALIVE untouched.
4. Split-brain default: refuse_writes without membership quorum.
5. Checkpoints are local/cluster KV keys — no external SaaS.
6. No central telemetry.
```

---

## § 1 — Summary

Add namespace isolation with resource quotas and a versioned RBAC schema, plus DAG checkpoint/resume and placement failover when topology marks a node DEAD.

---

## § 2 — Multi-Tenancy

### 2.1 Namespace

```typescript
interface Namespace {
  id: string;
  quotas: { maxConcurrentWorkflows: number; maxPlacedNodes: number };
}
```

### 2.2 RBAC (schema version `1`)

| Role | Permissions |
|------|-------------|
| `viewer` | `workflow:read` |
| `operator` | `workflow:read`, `workflow:run` |
| `admin` | all + `namespace:manage`, `cluster:admin` |

Authorize `(principalId, namespaceId, permission)` — deny by default.

---

## § 3 — Fault Tolerance

### 3.1 Checkpoint

Record `workflowId`, `namespaceId`, placement plan, and completed DAG node ids.

### 3.2 Failover

Given membership snapshot: for placements assigned to DEAD/EVICTED nodes, re-place those DAG nodes onto ALIVE members (reuse RFC-0009 scoring). Emit `FailoverPlan`.

### 3.3 Split-brain

`splitBrainPolicy: "refuse_writes" | "allow_local"` — default `refuse_writes` when alive members < quorum.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("M2.5"). Linked to M2.5.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0012 · M2.5*
