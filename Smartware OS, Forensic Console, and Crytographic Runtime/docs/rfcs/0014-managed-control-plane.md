---
label: RFC:MANAGED-CONTROL-PLANE-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0014"
title: "Implement Managed Control Plane Alpha — Cluster Lifecycle, Scaling Policy, Rolling Upgrades"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.1"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0014 — Managed Control Plane Alpha

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.1 — Managed Control Plane Alpha (Aug 2028)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. API must be self-hostable (ownerware tiebreaker).
2. No phone-home. No metering/billing in this module.
3. Cluster lifecycle + scaling policy + rolling upgrade only.
4. Do not scaffold M3.2 serverless/WASM until directed.
5. Fail-closed on invalid scale bounds and upgrade while
   already upgrading / decommissioned.
```

---

## § 1 — Summary

Ship an in-process **Control Plane Alpha** that registers clusters, tracks worker/control nodes, applies scaling policy (desired/min/max), and orchestrates rolling upgrades via drain → upgrade → ready batches. The same API shape works for managed cloud or customer-operated installs.

---

## § 2 — Design

### 2.1 Cluster lifecycle

| Operation | Behaviour |
|-----------|-----------|
| `createCluster` | Allocates `clusterId`, status `ready`, empty node set |
| `registerNode` | Adds node in `ready` (or `pending` if over desired — still tracked) |
| `decommissionCluster` | Marks `decommissioned`; further mutations deny |

### 2.2 Scaling policy

```typescript
interface ScalingPolicy {
  desiredNodes: number;
  minNodes: number;
  maxNodes: number;
}
```

Invariants: `0 ≤ min ≤ desired ≤ max`. `reconcileScaling` returns add/remove intents; does not auto-provision remote VMs in alpha.

### 2.3 Rolling upgrade

`startRollingUpgrade(clusterId, toVersion, batchSize?)` builds ordered plan over ready workers. `advanceUpgrade(planId)` drains a batch, bumps `version`, returns them to `ready`. Control-role nodes upgrade last. Abort if cluster decommissioned.

### 2.4 Out of scope (M3.1)

- Real cloud provider provisioning
- Multi-region / global routing (M3.4)
- Serverless / WASM (M3.2)
- Billing, portal UI, marketplace

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("ready"). Linked to M3.1.
  Sign-off directed by the DRI; agent recorded the entry.
  Phase 2 → Phase 3 gate already cleared 2026-09-09.
```

---

*Bell Corporate Labs · RFC-0014 · M3.1*
