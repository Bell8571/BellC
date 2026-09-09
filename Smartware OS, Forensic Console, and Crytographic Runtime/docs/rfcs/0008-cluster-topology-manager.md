---
label: RFC:CLUSTER-TOPOLOGY-MANAGER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0008"
title: "Implement Cluster Topology Manager — Heartbeat, Join/Evict, Failure Detection, mTLS Defaults"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 2
milestone: "M2.1"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0008 — Cluster Topology Manager v1

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 2 — Distributed Fabric
> **Milestone:** M2.1 — Cluster Topology Manager v1 (July 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. This RFC is ACCEPTED. Phase 1 → Phase 2 gate is cleared.
2. mTLS MUST be on by default for network transports.
   Plaintext inter-node sockets are prohibited.
3. In-process / loopback transport is allowed for tests and
   single-process simulation only; it must not be the
   production default for multi-host clusters.
4. No central telemetry sink. Membership events stay local.
5. Do not implement M2.2+ under this RFC number.
```

---

## § 1 — Summary

Introduce a Cluster Topology Manager that discovers and tracks Smartware cluster members via join, heartbeat, suspect/dead failure detection, and graceful evacuate / hard evict. A pluggable network abstraction carries membership messages; network transports require mTLS by default per Authority-0 Phase 2 rules.

---

## § 2 — Motivation

Phase 1 is single-process. Distributed DAG scheduling (M2.2) and the message bus (M2.3) need a shared membership view before placing work or routing events. Without failure detection, node loss leaves dangling assignments.

### 2.1 Desired Outcome

- Local membership table with states: `JOINING | ALIVE | SUSPECT | DEAD | EVICTED`
- Configurable heartbeat interval and failure / suspect timers
- Idempotent join and heartbeat handling
- Graceful evacuate vs forced evict
- `InProcessTransport` for tests; `requireMtls: true` default on any socket transport

### 2.2 Non-Goals

- Cross-region topology (Phase 3)
- Raft consensus (M2.4)
- Workload placement (M2.2)

---

## § 3 — Design

### 3.1 Types

```typescript
type MembershipState = "JOINING" | "ALIVE" | "SUSPECT" | "DEAD" | "EVICTED";

interface ClusterMember {
  nodeId: string;
  address: string;
  state: MembershipState;
  joinedAt: string;
  lastHeartbeatAt: string;
  metadata: Record<string, string>;
}

type TopologyMessage =
  | { type: "JOIN"; member: Omit<ClusterMember, "state" | "joinedAt" | "lastHeartbeatAt"> }
  | { type: "HEARTBEAT"; nodeId: string; sentAt: string }
  | { type: "LEAVE"; nodeId: string }
  | { type: "EVICT"; nodeId: string; reason: string };
```

### 3.2 Failure Detection

1. Each ALIVE member must refresh `lastHeartbeatAt` within `heartbeatIntervalMs`.
2. If silent past `failureTimeoutMs` → `SUSPECT`.
3. If still silent past `suspectGraceMs` → `DEAD` and emit membership event.
4. Local clock injectable for tests.

### 3.3 Network Abstraction

```typescript
interface TopologyTransport {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  broadcast(msg: TopologyMessage): Promise<void>;
  send(to: string, msg: TopologyMessage): Promise<void>;
  onMessage(handler: (from: string, msg: TopologyMessage) => void): void;
}
```

Socket implementations MUST refuse to start without TLS material when `requireMtls` is true (default).

### 3.4 Feature Flag

`SMARTWARE_CLUSTER=0` disables cluster CLI / manager start (exit 2), matching Phase 1 kill-switch style.

---

## § 4 — Security

- mTLS default for inter-node network paths
- No phone-home; membership stays in-cluster
- Certificates supplied by operator (customer holds keys)

---

## § 5 — Test Plan

- Join is idempotent
- Heartbeat refreshes ALIVE
- Missed heartbeats → SUSPECT → DEAD
- Evict is idempotent
- InProcessTransport does not require certs (test-only)
- Creating a network transport without certs fails closed

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Authored after Phase 1 → Phase 2 gate clearance.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review → accepted
  Phase 1 gate cleared by DRI in session ("clear phase 1").
  M2.1 Topology Manager authorised. Linked to milestone: M2.1.
  Sign-off directed by the DRI; agent recorded the entry
  and did not self-approve.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| Phase 2 spec | `docs/04_PHASE_2_DISTRIBUTED_FABRIC.md` |
| Phase 1 GA | `docs/03_PHASE_1_RUNTIME_DAG.md` |

---

*Bell Corporate Labs · smartware-core · RFC-0008 · M2.1*
