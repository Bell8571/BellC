---
label: PHASE:RUNTIME-DAG-v1
classification: NORMATIVE
security_level: INTERNAL
version: "1.0.0"
date: 2026-09-09
phase: 1
window: "Q4 2026 – Q2 2027"
status: active
depends_on: "v1.0.0 GA"
owner: Core Runtime Team
authority: CORE-DIRECTIVE:AUTHORITY-0
---

# Phase 1 — Runtime DAG

> Replace linear task queues with a dependency-aware,
> parallel-capable Directed Acyclic Graph execution engine.

---

## AI Build Instructions

TASK: Implement the Runtime DAG engine.
READ: docs/AI_INSTRUCTIONS.md before writing any code.
CONSTRAINT: DAG compiler must include cycle detection before
parallel execution engine is wired (see § 3, Phase 1 rules).
SCOPE: Single-node only. Do not scaffold multi-host topology.
IDEMPOTENCY: Every node transition handler must be idempotent.
FAIL-CLOSED: Compiler rejects graphs with cycles — it does not
attempt auto-repair.
OUTPUT: Executable milestones in order: M1.1 → M1.6.

---

## Core Capabilities

### DAG Compiler
Converts declarative workflow definitions into optimized execution
graphs. Performs static analysis, cycle detection (Kahn's algorithm),
and topological sort before emitting a resolved execution plan.

### Dependency Resolver
Runtime component tracking node state transitions. Triggers
downstream nodes on completion or failure. Implements:
- Configurable retry with exponential back-off
- Timeout propagation across dependency chains
- Partial failure isolation (failed branch does not halt siblings)

### Parallel Execution Engine
Thread-pool and async executor upgrade. Supports concurrent DAG
branch execution with back-pressure and per-workflow resource limits.

### DAG Visualizer
Developer-facing CLI and web UI for inspecting live and historical
DAG execution traces. Ships as a sidecar to the main daemon.

### Conditional Branching
`if/else`, `switch`, and `loop` constructs within workflow
definitions evaluated at runtime against node output payloads.

### Event-Driven Triggers
Webhook and message-queue listeners that initiate or resume
specific DAG nodes without restarting the whole graph.

---

## Milestones

| ID | Milestone | Target | Description |
|----|-----------|--------|-------------|
| M1.1 | DAG Compiler Alpha | Oct 2026 | Static analysis, cycle detection, topological sort |
| M1.2 | Dependency Resolver v1 | Nov 2026 | State transitions, retry, timeout propagation |
| M1.3 | Parallel Execution Engine | Jan 2027 | Concurrent branch execution, back-pressure |
| M1.4 | DAG Visualizer Beta | Feb 2027 | Live + historical trace inspection |
| M1.5 | Conditional Branching + Event Triggers | Mar 2027 | Runtime branching, webhook/queue hooks |
| M1.6 | Phase 1 GA + Regression Suite | Apr 2027 | Full regression pass; durable resolver state RFC accepted; phase gate review |

---

## Related RFCs

RFC-0001 through RFC-0007 are `accepted` (DRI: Bell Corporate Labs). Phase 1 → Phase 2 still requires explicit human phase-gate sign-off; agents must not scaffold Phase 2 until that gate is cleared.

| Milestone | RFC | Status |
|-----------|-----|--------|
| M1.1 | `docs/rfcs/0006-plugin-api.md` | accepted |
| M1.1 | `docs/rfcs/0001-dag-compiler.md` | accepted |
| M1.2 | `docs/rfcs/0002-dependency-resolver.md` | accepted |
| M1.3 | `docs/rfcs/0003-parallel-execution-engine.md` | accepted |
| M1.4 | `docs/rfcs/0004-dag-visualizer.md` | accepted |
| M1.5 | `docs/rfcs/0005-conditional-branching-events.md` | accepted |
| M1.6 | `docs/rfcs/0007-durable-resolver-state.md` | accepted |

---

## Dependencies

- v1.0.0 GA runtime must be stable before M1.1
- Plugin API contract finalized before M1.1 (RFC-0006, accepted)
- SDK must expose DAG definition DSL by M1.3
- CI/CD pipeline upgraded to test DAG graph permutations by M1.2
- Durable resolver state (own RFC) accepted before M1.6; M1.2 remains in-memory

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Node transition overhead | < 5 ms |
| Maximum graph size | 10,000 nodes |
| DAG compile time (P95) | < 200 ms |
| Regression rate on v1.0.0 workloads | 0% |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cycle detection edge cases in large graphs | Medium | High | Fuzz test with 10k+ node graphs before M1.1 ships |
| SDK DSL not ready by M1.3 | Medium | High | Stub DSL in parallel; unblock compiler work |
| Parallel executor causes resource starvation | Low | High | Per-workflow resource caps enforced from day one |
| DAG Visualizer scope creep | High | Medium | Ship CLI-only at M1.4; web UI is stretch goal |
| Phase 1 regression breaks v1.0.0 workloads | Low | Critical | Shadow-run all existing workloads against DAG engine |
