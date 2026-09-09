---
label: RFC:MULTI-REGION-FABRIC-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0017"
title: "Implement Multi-Region Fabric + Global Routing — Latency-Aware Active-Active/Passive"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.4"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0017 — Multi-Region Fabric + Global Routing

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.4 — Multi-Region Fabric + Global Routing (Mar 2029)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Routing is local/self-hostable — no phone-home anycast SaaS.
2. Support active-active and active-passive fabrics.
3. Latency-aware route selection; track cross-region overhead vs 20ms SLA.
4. Unhealthy regions are skipped fail-closed when no healthy candidate.
5. Do not scaffold M3.5 enterprise SSO until directed.
```

---

## § 1 — Summary

Introduce a **MultiRegionFabric** that registers geographic regions (optionally linked to control-plane clusters), records pairwise latency, and routes workflow placement requests to the lowest-latency healthy region within an active-active or active-passive policy — measuring added overhead against a 20ms budget.

---

## § 2 — Design

### 2.1 Region

```typescript
interface Region {
  regionId: string;
  displayName: string;
  endpoint: string; // customer-controlled; never a hardcoded SaaS URL
  clusterId?: string;
  healthy: boolean;
  mode: "active" | "standby";
}
```

### 2.2 Routing

`route(request)` returns `{ regionId, estimatedLatencyMs, overheadMs, withinSla }` where overhead is relative to the lowest observed latency in the fabric. Prefer active healthy regions; standby only when no active healthy candidate (active-passive failover) or when mode is active-active and region is active.

### 2.3 Latency matrix

Operator-supplied or probe-recorded RTT samples. No external telemetry export.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("Next buddy"). Linked to M3.4.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0017 · M3.4*
