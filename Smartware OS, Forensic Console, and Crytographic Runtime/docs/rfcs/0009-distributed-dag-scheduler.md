---
label: RFC:DISTRIBUTED-DAG-SCHEDULER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0009"
title: "Implement Distributed DAG Scheduler Alpha — Cross-Node Placement, Locality Scoring, Load Balancing"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 2
milestone: "M2.2"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0009 — Distributed DAG Scheduler Alpha

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 2 — Distributed Fabric
> **Milestone:** M2.2 — Distributed DAG Scheduler Alpha (September 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Depends on RFC-0008 membership (ALIVE-only placement).
2. Do not implement Raft / M2.4 store here — use a local
   PlacementLedger stub that records decisions for later sync.
3. Placement must be deterministic given the same graph +
   membership + prior load view.
4. Fail-closed when zero ALIVE members exist.
5. No central telemetry; placement logs stay local.
```

---

## § 1 — Summary

Place each compiled DAG node onto an ALIVE cluster member using locality (prefer hosts that already run dependencies), optional affinity tags from node config, and load balancing. Emit a `PlacementPlan` and record it in a local ledger (stand-in until M2.4 Distributed State Store).

---

## § 2 — Design

### 2.1 Eligibility

Only members with `state === "ALIVE"` may receive work. SUSPECT / DEAD / EVICTED / JOINING are excluded.

### 2.2 Scoring (higher wins)

```
score = localityWeight * locality
      + affinityWeight * affinity
      - loadWeight * normalizedLoad
```

- **locality** ∈ {0,1}: 1 if any `dependsOn` node is already placed on the candidate.
- **affinity** ∈ {0,1}: 1 if `node.config.affinity` (string or string[]) intersects member `metadata` values/keys.
- **normalizedLoad**: assigned count on candidate / max(1, max load among candidates).

Tie-break: lexicographically smaller `nodeId`.

### 2.3 Order

Place nodes in compiler `executionOrder` batch order (within batch: lexicographic id) so dependencies are placed first.

### 2.4 PlacementLedger (local stub)

```typescript
interface PlacementRecord {
  workflowId: string;
  plan: PlacementPlan;
  savedAt: string;
}
```

INVARIANT (M2.2): ledger is process-local; not consensus. Marked for replacement by M2.4.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("lets move forward"). Linked to M2.2.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0009 · M2.2*
