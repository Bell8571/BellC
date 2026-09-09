---
label: RFC:SMARTWARE-MESSAGE-BUS-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0010"
title: "Implement Smartware Message Bus v1 — At-Least-Once Delivery and Backlog Replay"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 2
milestone: "M2.3"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0010 — Smartware Message Bus v1

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 2 — Distributed Fabric
> **Milestone:** M2.3 — Smartware Message Bus v1 (November 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Cluster-boundary only — no external broker SaaS.
2. At-least-once delivery; consumers must be idempotent.
3. Duplicate publish id is a no-op.
4. Backlog persists for reconnect replay from sequence.
5. Network fan-out later uses mTLS (RFC-0008); M2.3 alpha
   ships an in-process / local backlog engine first.
6. No central telemetry sink.
```

---

## § 1 — Summary

In-cluster message bus for DAG event propagation: subject publish/subscribe, monotonic sequence backlog, consumer ack, and reconnect replay. Delivery is **at-least-once** until ack.

---

## § 2 — Design

### 2.1 Message

```typescript
interface BusMessage {
  id: string;
  subject: string;
  payload: unknown;
  seq: number;
  publishedAt: string;
}
```

### 2.2 API

- `publish(subject, payload, { id? })` — append to backlog; fan-out to active subscribers; duplicate `id` → no-op
- `subscribe(subject, consumerId, handler)` — deliver matching messages; handler receives `ack()`
- `reconnect(consumerId)` — redeliver all unacked messages for that consumer from backlog order
- `replayFrom(consumerId, fromSeq)` — deliver backlog entries with `seq >= fromSeq` that match the consumer's subject filter (at-least-once)

### 2.3 Ack

Until `ack(messageId)` for that consumer, the message remains pending and is eligible for redelivery.

### 2.4 Non-Goals (later)

- Cross-region routing (Phase 3)
- Exactly-once (not promised)
- External NATS dependency

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("ready"). Linked to M2.3.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0010 · M2.3*
