---
label: PHASE:DISTRIBUTED-FABRIC-v1
classification: NORMATIVE
security_level: INTERNAL
version: "1.0.0"
date: 2026-09-09
phase: 2
window: "Q3 2027 – Q2 2028"
status: active
depends_on: "Phase 1 GA (M1.6)"
owner: Distributed Systems Team
authority: CORE-DIRECTIVE:AUTHORITY-0
phase_gate_cleared: "2026-09-09"
phase_gate_cleared_by: "Bell Corporate Labs (DRI)"
---

# Phase 2 — Distributed Fabric

> Extend the Phase 1 DAG runtime across multiple nodes into
> a cluster-aware, fault-tolerant distributed execution fabric.
>
> **Phase gate:** Phase 1 → Phase 2 cleared 2026-09-09 by DRI
> (Bell Corporate Labs). Phase 2 scaffolding on `main` is authorised.

---

## AI Build Instructions

TASK: Implement the Distributed Fabric layer.
READ: docs/AI_INSTRUCTIONS.md before writing any code.
PREREQUISITE: M1.6 (Phase 1 GA) must be verified before
any Phase 2 scaffolding is introduced to main.
TELEMETRY: All observability components must support
local-only mode. No external telemetry sink by default.
CONSENSUS: Annotate all consensus invariants inline.
Implementation must be formally reviewable.
SECURITY: mTLS on by default for ALL inter-node comms.
Certificate rotation must be automated.
SCOPE: Multi-host, single-region in this phase.
Multi-region is Phase 3 territory.

---

## Core Capabilities

### Cluster Topology Manager
Discovers, registers, and monitors nodes within a Smartware cluster.
Heartbeat protocol with configurable failure detection thresholds.
Supports dynamic node admission and graceful eviction.

### Distributed DAG Scheduler
Extends the Phase 1 scheduler to split execution graphs across nodes.
Locality-aware placement, data affinity scoring, and load balancing.
Scheduler decisions are recorded in the Distributed State Store.

### Smartware Message Bus
High-throughput internal message bus for inter-node DAG event
propagation. At-least-once delivery guarantees. Backlog persistence
for node-reconnect replay. Inspired by NATS JetStream semantics —
runs entirely within the cluster boundary.

### Distributed State Store
Consensus-backed (Raft-inspired) key-value store for shared DAG
state, checkpointing, and distributed locking. All invariants
annotated inline. No external coordination service required.

### Fault-Tolerant Execution
Automatic node failover. DAG checkpoint/resume on node loss.
Split-brain resolution policy configurable per cluster.
Recovery target: P99 < 30 seconds.

### Multi-Tenancy Isolation
Namespace-based resource quotas. Execution isolation per tenant.
RBAC schema defined before M2.5 (hard dependency).

### Observability Layer
OpenTelemetry-compatible distributed tracing. Metrics aggregation.
Centralized log fabric. Local-only mode is the default; external
export is an explicit opt-in with customer-configured endpoints.

---

## Milestones

| ID | Milestone | Target | Description |
|----|-----------|--------|-------------|
| M2.1 | Cluster Topology Manager v1 | Jul 2027 | Heartbeat, node join/evict, failure detection |
| M2.2 | Distributed DAG Scheduler Alpha | Sep 2027 | Cross-node graph placement, locality scoring |
| M2.3 | Smartware Message Bus v1 | Nov 2027 | At-least-once delivery, backlog replay |
| M2.4 | Distributed State Store | Jan 2028 | Raft consensus layer, annotated invariants |
| M2.5 | Fault-Tolerant Execution + Multi-Tenancy | Mar 2028 | Failover, RBAC, namespace isolation |
| M2.6 | Observability Layer + Phase 2 GA | May 2028 | OTel tracing, metrics, phase gate review |

---

## Related RFCs

| Milestone | RFC | Status |
|-----------|-----|--------|
| M2.1 | `docs/rfcs/0008-cluster-topology-manager.md` | accepted |
| M2.2 | `docs/rfcs/0009-distributed-dag-scheduler.md` | accepted |
| M2.3 | `docs/rfcs/0010-smartware-message-bus.md` | accepted |
| M2.4 | `docs/rfcs/0011-distributed-state-store.md` | accepted |
| M2.5 | `docs/rfcs/0012-fault-tolerance-multi-tenancy.md` | accepted |

---

## Dependencies

- Phase 1 GA (M1.6) verified before any Phase 2 code reaches main — **cleared 2026-09-09**
- Network topology abstraction layer required before M2.1 — delivered in RFC-0008 / `clusterTransport.ts`
- Consensus store requires formal invariant review before M2.4 merges
- Security model (mTLS, cert rotation, RBAC schema) defined before M2.5 — mTLS default locked in RFC-0008

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Throughput scaling to 50 nodes | Linear with < 10% overhead |
| Node failure recovery (P99) | < 30 seconds |
| Message bus throughput (10-node cluster) | > 1M messages/sec |
| Data loss on single-node failure | Zero with consensus store enabled |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Consensus implementation correctness | Medium | Critical | TLA+ model or equivalent before M2.4 merges |
| Network partition handling edge cases | Medium | High | Chaos testing harness from M2.1 onwards |
| Message bus back-pressure under spike load | Medium | High | Load test at 5× expected peak before M2.3 GA |
| RBAC schema lock-in limits future flexibility | Low | Medium | Schema versioning from day one |
| Distributed scheduler increases P99 latency | Medium | High | Baseline latency budget defined before M2.2 |
