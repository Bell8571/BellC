---
label: RFC:AI-SCHEDULER-BILLING-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0020"
title: "Implement AI Scheduler + Billing Engine — Local Training, Metering Flag Default Off"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.7"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0020 — AI Scheduler + Billing Engine GA

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.7 — AI Scheduler + Billing Engine GA (Oct 2029)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. AI scheduler trains on LOCAL fleet telemetry only by default.
2. No central trace aggregation / phone-home for training.
3. BillingEngine is a SEPARATE module; meteringEnabled defaults FALSE.
4. Never import billing into executionEngine / aiScheduler cores.
5. Baseline quality: AI placement must beat round-robin on reference set
   before recommend() returns preferAi=true.
6. Do not scaffold M3.8 Phase 3 GA gate paperwork until directed.
```

---

## § 1 — Summary

Ship (1) a **local AI scheduler** that learns node→host affinity from in-process fleet samples and recommends placements that beat round-robin, and (2) a **billing engine** gated behind `meteringEnabled: false` that records per-node execution meters and budget alerts only when explicitly enabled.

---

## § 2 — Modules

| Module | File | Default |
|--------|------|---------|
| AI Scheduler | `src/aiScheduler.ts` | Local training on |
| Billing Engine | `src/billingEngine.ts` | Metering **off** |

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("next"). Linked to M3.7.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0020 · M3.7*
