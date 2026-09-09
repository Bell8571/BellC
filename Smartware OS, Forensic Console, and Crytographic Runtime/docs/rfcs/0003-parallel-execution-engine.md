---
label: RFC:PARALLEL-EXECUTION-ENGINE-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0003"
title: "Implement the Smartware Parallel Execution Engine — Concurrent DAG Branch Execution, Back-Pressure, and Resource Limits"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 1
milestone: "M1.3"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0003 — Parallel Execution Engine

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.3 — Parallel Execution Engine (January 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. BLOCKED: This RFC depends on RFC-0002 reaching `accepted`
   and the NodeReadyEvent / ResolverInboundEvent contracts
   being frozen. Do not implement any scope here until BOTH
   conditions are met and §8 contains a DRI sign-off.

2. All inbound/outbound event types are defined in RFC-0002
   §3.2. Import them — do not redefine or fork them.

3. The Execution Engine MUST NOT manage retry logic, state
   transitions, or dependency evaluation. Those belong
   exclusively to the Dependency Resolver (RFC-0002).
   The Engine executes what the Resolver authorises.
   Nothing more.

4. Back-pressure is mandatory from day one. The Engine must
   never accept more work than its resource limits allow.
   Spilling to disk or unbounded queuing are prohibited.

5. Every node execution is wrapped in an idempotency
   envelope. The Engine echoes back the idempotencyKey
   from the NODE_READY event in every inbound event it
   sends to the Resolver. This is non-negotiable.

6. Fail-closed: if the Engine cannot determine whether a
   node completed successfully (e.g. executor process
   crashed mid-run), it emits NODE_FAILED — never
   NODE_SUCCEEDED. Ambiguity resolves as failure.

7. This RFC gates M1.4 (DAG Visualizer) and M1.5
   (Conditional Branching). The Visualizer consumes
   live execution events from the Engine. The execution
   event stream contract (§3.2) must be frozen before
   those milestones scaffold.
```

---

## § 1 — Summary

This RFC defines the Smartware Parallel Execution Engine —
the component that receives `NODE_READY` events from the
Dependency Resolver, dispatches node work to registered
executors concurrently, enforces per-workflow and global
resource limits, applies back-pressure when capacity is
exhausted, and feeds execution lifecycle events back to
the Resolver.

The Engine is intentionally thin. It owns concurrency,
dispatching, resource accounting, and result reporting.
It does not own retry logic, dependency evaluation, or
state persistence — those remain in the Resolver (RFC-0002).
This separation ensures that the Engine can be replaced,
scaled, or extended (e.g. distributed in Phase 2) without
touching the Resolver's state machine.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

The v1.0.0 runtime executes tasks one at a time on a
single thread. There is no concept of concurrent branch
execution. Workflows that are naturally parallel are
artificially bottlenecked. The Dependency Resolver
(RFC-0002) will emit multiple `NODE_READY` events
simultaneously for independent branches — without an
Engine capable of processing them concurrently, those
events queue up and execute serially, defeating the
purpose of the DAG model.

### 2.2 Desired Outcome

An Execution Engine that:
- Maintains a configurable worker pool for concurrent
  node execution
- Dispatches `NODE_READY` events to available workers
  immediately and in parallel
- Applies back-pressure when the worker pool is at
  capacity — queuing bounded, not unbounded
- Enforces per-workflow CPU and memory resource limits
- Reports execution lifecycle back to the Resolver via
  the frozen inbound event contract
- Exposes a live event stream for the DAG Visualizer
  (M1.4) to consume

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.3 |
| Milestone Name | Parallel Execution Engine |
| Target Date | January 2027 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Blocked By | M1.2 — Dependency Resolver v1 (RFC-0002) |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  Dependency Resolver (RFC-0002)
          │
          │  NODE_READY events
          ▼
  ┌──────────────────────────────────┐
  │         Dispatch Queue           │
  │                                  │
  │  Bounded FIFO. Max depth =       │
  │  workerPoolSize × 2.             │
  │  Back-pressure applied when      │
  │  full — Resolver notified to     │
  │  pause emission.                 │
  └────────────────┬─────────────────┘
                   │  dequeue when worker free
                   ▼
  ┌──────────────────────────────────┐
  │         Worker Pool              │
  │                                  │
  │  N concurrent workers.           │
  │  N = config.maxConcurrentNodes.  │
  │  Each worker owns one node       │
  │  execution at a time.            │
  └──────┬───────────────────────────┘
         │  dispatch
         ▼
  ┌──────────────────────────────────┐
  │       Executor Registry          │
  │                                  │
  │  Looks up the registered         │
  │  NodeExecutor for the node type. │
  │  Wraps execution in:             │
  │  - Idempotency envelope          │
  │  - Timeout watchdog              │
  │  - Resource accounting           │
  │  - Panic/crash recovery          │
  └──────┬───────────────────────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
  NodeExecutor               Resource
  (user-registered           Ledger
  plugin / built-in)         (CPU + memory
                              per workflow)
    │
    │  result / error / timeout
    ▼
  ┌──────────────────────────────────┐
  │      Result Collector            │
  │                                  │
  │  Wraps result into the correct   │
  │  ResolverInboundEvent type.      │
  │  Echoes idempotencyKey.          │
  │  Emits to Resolver + live        │
  │  event stream (Visualizer).      │
  └──────────────────────────────────┘
         │
         ▼
  Dependency Resolver (NODE_STARTED /
                       NODE_SUCCEEDED /
                       NODE_FAILED /
                       NODE_TIMED_OUT)
```

### 3.2 Interface / API Contract

All event types are imported from RFC-0002. The Engine
adds the following new types for its own configuration,
executor registration, and live stream.

```typescript
import type {
  ResolverOutboundEvent,   // NODE_READY consumed from here
  ResolverInboundEvent,    // NODE_STARTED / SUCCEEDED / FAILED / TIMED_OUT
  ResolvedNode,
} from './dependencyResolver';

// ── Node Executor Interface ────────────────────────────
// Implemented by plugin authors and built-in node types.

export interface NodeExecutionContext {
  node: ResolvedNode;
  attempt: number;          // 1-based; matches NODE_READY.attempt
  idempotencyKey: string;   // must be echoed in all result events
  timeoutDeadline: string;  // ISO 8601 absolute deadline
  workflowId: string;
  signal: AbortSignal;      // fired when timeout or cancel occurs
}

export interface NodeExecutionResult {
  output?: unknown;         // optional structured output passed to
                            // downstream nodes via config interpolation
}

export interface NodeExecutor {
  /**
   * Execute a single node. Must honour signal.aborted.
   * Must complete or throw before timeoutDeadline.
   * Must be safe to abort mid-execution via signal.
   * Must not produce side effects if signal fires before
   * meaningful work begins (fail-closed on early abort).
   */
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

// ── Resource Limits ───────────────────────────────────

export interface ResourceLimits {
  maxCpuPercent?: number;     // 0–100; enforced via process accounting
  maxMemoryMb?: number;       // RSS limit for all executors combined
}

// ── Engine Configuration ──────────────────────────────

export interface ExecutionEngineConfig {
  maxConcurrentNodes: number;     // worker pool size; default: CPU count
  dispatchQueueDepth?: number;    // max queued NODE_READY events before
                                  // back-pressure; default: maxConcurrentNodes × 2
  globalResourceLimits?: ResourceLimits;
  perWorkflowResourceLimits?: ResourceLimits;
}

// ── Back-Pressure Signal ──────────────────────────────

export type BackPressureState = 'OPEN' | 'PRESSURED' | 'SATURATED';
// OPEN       — queue has capacity; emit freely
// PRESSURED  — queue > 50% full; Resolver should slow emission
// SATURATED  — queue full; Resolver must pause until OPEN

// ── Live Execution Event (for Visualizer, M1.4) ───────

export type ExecutionStreamEvent =
  | { type: 'NODE_DISPATCHED'; nodeId: string; workerId: string; attempt: number; dispatchedAt: string }
  | { type: 'NODE_COMPLETED';  nodeId: string; workerId: string; durationMs: number; outcome: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' }
  | { type: 'WORKER_IDLE';     workerId: string }
  | { type: 'BACK_PRESSURE_CHANGED'; state: BackPressureState; queueDepth: number };

// ── Executor Registry ─────────────────────────────────

export interface ExecutorRegistry {
  register(nodeType: string, executor: NodeExecutor): void;
  resolve(nodeType: string): NodeExecutor | undefined;
}

// ── Execution Engine API ──────────────────────────────

export interface ExecutionEngine {
  /**
   * Initialise the engine with config and executor registry.
   * Idempotent — calling twice is a no-op after first call.
   */
  init(config: ExecutionEngineConfig, registry: ExecutorRegistry): void;

  /**
   * Feed a NODE_READY event from the Dependency Resolver.
   * Returns the current BackPressureState after enqueue.
   * If SATURATED, caller must not call dispatch() again
   * until a BACK_PRESSURE_CHANGED(OPEN) event is emitted.
   */
  dispatch(event: ResolverOutboundEvent & { type: 'NODE_READY' }): BackPressureState;

  /**
   * Subscribe to inbound events destined for the Resolver.
   * The engine calls this handler as node executions complete.
   * Called from worker threads — handler must be thread-safe.
   */
  onResolverEvent(handler: (event: ResolverInboundEvent) => void): void;

  /**
   * Subscribe to the live execution stream.
   * Used by the DAG Visualizer (M1.4). Multiple subscribers allowed.
   */
  onStreamEvent(handler: (event: ExecutionStreamEvent) => void): void;

  /**
   * Cancel all in-flight and queued executions for a workflow.
   * Fires the AbortSignal on all active NodeExecutionContexts.
   * Returns when all workers have acknowledged cancellation.
   */
  cancelWorkflow(workflowId: string): Promise<void>;

  /**
   * Snapshot current engine state for observability.
   */
  snapshot(): EngineSnapshot;
}

export interface EngineSnapshot {
  activeWorkers: number;
  idleWorkers: number;
  queueDepth: number;
  backPressureState: BackPressureState;
  inFlightNodes: { nodeId: string; workerId: string; startedAt: string }[];
  resourceUsage: { cpuPercent: number; memoryMb: number };
}
```

### 3.3 Data Flow

1. Resolver emits `NODE_READY` → caller invokes
   `engine.dispatch(event)`
2. Engine enqueues the event in the **Dispatch Queue**
   - If queue depth > `dispatchQueueDepth`: returns
     `SATURATED` — caller must stop dispatching until
     `BACK_PRESSURE_CHANGED(OPEN)` fires
   - If queue depth > 50%: returns `PRESSURED`
   - Otherwise: returns `OPEN`
3. An idle **Worker** dequeues the event
4. Worker emits `NODE_DISPATCHED` to the live stream
5. Worker resolves the `NodeExecutor` from the registry
   - If no executor found for `node.type`: immediately
     emit `NODE_FAILED` with `UNKNOWN_EXECUTOR` error;
     return worker to idle pool
6. Worker constructs a `NodeExecutionContext`:
   - Sets `signal` from an `AbortController`
   - Calculates remaining time to `timeoutDeadline`
   - Starts a **Timeout Watchdog** timer
7. Worker emits `NODE_STARTED` → Resolver via
   `onResolverEvent` handler (echoes `idempotencyKey`)
8. Worker calls `executor.execute(ctx)`
   - **Happy path**: executor resolves with
     `NodeExecutionResult` → emit `NODE_SUCCEEDED`
   - **Executor throws**: emit `NODE_FAILED` with
     error message
   - **Timeout Watchdog fires**: abort signal fires →
     emit `NODE_TIMED_OUT`; if executor does not
     settle within a 5s grace period, worker is
     recycled and a new worker is spawned to maintain
     pool size
   - **Process crash / panic**: recovery wrapper catches
     and emits `NODE_FAILED` — never `NODE_SUCCEEDED`
9. Worker emits `NODE_COMPLETED` to live stream with
   duration and outcome
10. Worker checks **Resource Ledger**:
    - Updates CPU and memory accounting
    - If a workflow exceeds `perWorkflowResourceLimits`:
      emit `NODE_FAILED` for the current node with
      `RESOURCE_LIMIT_EXCEEDED`; Resolver applies its
      normal failure policy
11. Worker returns to idle pool; emits `WORKER_IDLE`
    to live stream
12. Engine re-evaluates back-pressure state and emits
    `BACK_PRESSURE_CHANGED` if state has changed

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Executor not found for node type | `NODE_FAILED` with `UNKNOWN_EXECUTOR` | Register executor before workflow run |
| Executor throws synchronously | `NODE_FAILED` with error string | Fix executor; retry via Resolver |
| Executor promise rejects | `NODE_FAILED` with rejection reason | Fix executor; retry via Resolver |
| Timeout watchdog fires | `NODE_TIMED_OUT` after `AbortSignal` | Increase node `timeout` or optimise executor |
| Executor ignores AbortSignal past grace period | Worker recycled; new worker spawned; `NODE_TIMED_OUT` | Executor must honour `signal.aborted` |
| Process crash inside executor | Panic recovery wrapper emits `NODE_FAILED` — never `NODE_SUCCEEDED` | Fix crash; retry via Resolver |
| Resource limit exceeded | `NODE_FAILED` with `RESOURCE_LIMIT_EXCEEDED` | Increase limits or reduce concurrency |
| Dispatch queue saturated | Return `SATURATED`; caller blocks dispatch | Wait for `BACK_PRESSURE_CHANGED(OPEN)` |
| Engine not initialised before dispatch | Throw synchronously with `ENGINE_NOT_INITIALISED` | Call `init()` first |

All ambiguous completion states resolve as `NODE_FAILED`.
The Engine never assumes a node succeeded.

### 3.5 Idempotency Guarantees

- Every `NODE_READY` event carries an `idempotencyKey`
  issued by the Resolver. The Engine echoes this key in
  `NODE_STARTED`, `NODE_SUCCEEDED`, `NODE_FAILED`, and
  `NODE_TIMED_OUT` events without modification.
- If the Engine receives a duplicate `NODE_READY` event
  for a node already in-flight or completed (same
  `idempotencyKey`), it is a no-op — no second dispatch.
- Workers are stateless between executions. All
  idempotency state is owned by the Resolver.

### 3.6 Worker Pool Lifecycle

```
  Engine.init()
       │
       ▼
  Spawn N idle workers (N = maxConcurrentNodes)
       │
  ┌────┴──────────────────────────────────────┐
  │  Worker lifecycle (per worker):            │
  │                                            │
  │   IDLE ──dequeue──▶ DISPATCHING            │
  │                           │                │
  │                    ┌──────┴──────┐         │
  │                    │  EXECUTING  │         │
  │                    └──────┬──────┘         │
  │                           │                │
  │              ┌────────────┼──────────┐     │
  │              ▼            ▼          ▼     │
  │           SUCCEEDED    FAILED   TIMED_OUT  │
  │              └────────────┴──────────┘     │
  │                           │                │
  │                      report result         │
  │                           │                │
  │                    IDLE ◀─┘                │
  └────────────────────────────────────────────┘

  On timeout past grace period:
    EXECUTING ──▶ RECYCLED (worker terminated)
    New worker spawned to maintain pool size N
```

---

## § 4 — Alternatives Considered

### Option A — Single shared thread pool, no per-workflow limits (Rejected)

**Summary:** One global thread pool; all workflows share
it with no resource partitioning.

**Reason rejected:** A runaway workflow can exhaust the
pool and starve all other workflows. Per-workflow resource
limits are a Phase 1 requirement (`docs/03_PHASE_1_RUNTIME_DAG.md`
specifies resource limits as a core capability). Without
them, multi-workflow deployments are operationally unsafe.

### Option B — Process-per-node execution (Rejected)

**Summary:** Each node execution spawns a new OS process,
providing hard isolation.

**Reason rejected:** Process spawn overhead (~50–200ms) would
blow the < 5ms node transition overhead target from Phase 1
success metrics. Process-per-node is appropriate for Phase 3
serverless execution where cold-start budgets are larger.
For Phase 1 single-node execution, in-process workers with
`AbortSignal` provide sufficient isolation at acceptable
cost. Noted as a Phase 3 architectural option.

### Option C — Async event loop only, no worker threads (Rejected)

**Summary:** Run all node execution on a single async event
loop; rely on non-blocking executor contracts.

**Reason rejected:** Executors written by plugin authors
cannot be guaranteed non-blocking. A synchronous executor
would stall the entire event loop. Worker threads provide
genuine parallelism and isolate blocking executors without
requiring authors to reason about async constraints.
Ownerware tiebreaker applied: prefer the model that gives
plugin authors the simplest, most predictable contract.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| Dependency Resolver (RFC-0002) | Major — primary consumer | Resolver emits NODE_READY; Engine feeds events back |
| DAG Compiler (RFC-0001) | None | Engine consumes resolved nodes via Resolver |
| DAG Visualizer (M1.4) | Dependency | Visualizer subscribes to `onStreamEvent` |
| Conditional Branching (M1.5) | Dependency | Branch evaluation produces NODE_READY; Engine executes |
| Plugin API v1 | Major | `NodeExecutor` interface is the new plugin contract |
| SDK | Moderate | `ExecutionEngine`, `ExecutorRegistry`, config types exported |
| CLI (`smartware run`) | Moderate | CLI initialises Engine, wires Resolver ↔ Engine loop |
| v1.0.0 linear queue | None | Remains behind feature flag until M1.6 regression suite |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| RFC-0002 frozen event types | Internal | `NODE_READY`, `ResolverInboundEvent` |
| Worker thread primitive | Internal | stdlib (Worker Threads / goroutines); no external package |
| AbortController / AbortSignal | Internal | stdlib in target runtimes; no external package |
| Resource accounting (CPU/memory) | Internal | Process metrics API; stdlib only |
| Executor Registry | Internal | New component; no external package |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — Engine is
      fully in-process; no network calls; no external
      telemetry by default
- [x] **Telemetry is opt-in** — live event stream is
      local subscriber only; no external sink
- [x] **Fail-closed** — ambiguous executor outcome
      always resolves as `NODE_FAILED`
- [x] **Idempotent** — duplicate NODE_READY events
      are no-ops; idempotencyKey echoed faithfully
- [x] **Feature flags** — no billing or metering code
- [x] **mTLS** — N/A (Phase 1; single-node)
- [x] **Plugin isolation** — executor crash cannot
      corrupt Resolver state; panic recovery wrapper
      is mandatory on every worker

### 5.4 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Node dispatch latency (queue → worker start) | < 2 ms | Microbenchmark in CI |
| Node transition overhead (end-to-end per hop) | < 5 ms | Integration benchmark |
| Worker pool scale: 10k node graph | Linear throughput | Stress test in CI |
| Back-pressure detection latency | < 1 ms | Queue depth probe benchmark |
| Worker recycle on timeout grace expiry | < 5s | Timeout scenario test |
| Memory overhead per idle worker | < 4 MB | Heap profiler |

### 5.5 Rollback Plan

The Execution Engine is additive in M1.3. The v1.0.0 linear
queue remains fully operational via `SMARTWARE_DAG_COMPILER=0`
feature flag (RFC-0001 §5.5).

If the Engine is found to be incorrect post-merge:
1. Set `SMARTWARE_DAG_COMPILER=0` — reverts to v1.0.0
   queue; Engine and Resolver are never called
2. No data loss risk — Engine holds only in-flight
   execution state; no persistence
3. Worker pool is shut down cleanly on process exit;
   no leaked threads
4. File bug against RFC-0003; fix in patch release

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | Should `maxConcurrentNodes` default to logical CPU count or a fixed value (e.g. 8)? CPU count is adaptive but unpredictable in CI environments | Bell Corporate Labs | TBD | ☐ |
| 2 | What is the grace period for an executor that ignores AbortSignal before the worker is recycled? 5s proposed — is that too long for the Visualizer UX? | Bell Corporate Labs | TBD | ☐ |
| 3 | Should the live event stream (`onStreamEvent`) be a push model (callback) or pull model (async iterator)? Pull is easier to back-pressure but harder for multiple subscribers | Bell Corporate Labs | TBD | ☐ |
| 4 | How does the Resource Ledger measure CPU percent for in-process workers? OS-level process metrics are coarse — is that acceptable for Phase 1? | Bell Corporate Labs | TBD | ☐ |
| 5 | Should `cancelWorkflow()` be synchronous (fire-and-forget AbortSignal) or async (await worker acknowledgement)? Async proposed for correctness | Bell Corporate Labs | TBD | ☐ |
| 6 | Should plugin executors be allowed to declare their own resource requirements at registration time, for smarter scheduling? Deferred to Phase 2 distributed scheduler or treat as stretch goal here? | Bell Corporate Labs | TBD | ☐ |

---

## § 7 — Implementation Plan

> [HUMAN REQUIRED] — Do not populate until RFC status
> is `accepted` and §8 contains a DRI sign-off.

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| Worker pool implementation (spawn, idle, recycle) | TBD | TBD | M1.3 |
| Dispatch Queue with back-pressure | TBD | TBD | M1.3 |
| Executor Registry (register + resolve) | TBD | TBD | M1.3 |
| Idempotency envelope + key echo | TBD | TBD | M1.3 |
| Timeout Watchdog + AbortSignal wiring | TBD | TBD | M1.3 |
| Panic / crash recovery wrapper | TBD | TBD | M1.3 |
| Resource Ledger (CPU + memory accounting) | TBD | TBD | M1.3 |
| Result Collector → Resolver event emission | TBD | TBD | M1.3 |
| Live stream (`onStreamEvent`) for Visualizer | TBD | TBD | M1.3 |
| `cancelWorkflow()` implementation | TBD | TBD | M1.3 |
| `snapshot()` implementation | TBD | TBD | M1.3 |
| CLI wiring (`smartware run` Resolver ↔ Engine loop) | TBD | TBD | M1.3 |
| SDK export of all Engine types and interfaces | TBD | TBD | M1.3 |
| Performance benchmark suite | TBD | TBD | M1.3 |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit — worker lifecycle | All states and transitions covered | Including recycle on grace period expiry |
| Unit — dispatch queue | Back-pressure at 50% and 100% depth | OPEN / PRESSURED / SATURATED transitions |
| Unit — idempotency | Duplicate NODE_READY is always a no-op | Same idempotencyKey, same workflowId |
| Unit — resource ledger | Limit exceeded → NODE_FAILED | Per-workflow and global limits |
| Integration — full DAG run | 10-node happy path; single failure; cascading failure | Wired with real Resolver from RFC-0002 |
| Integration — cancellation | cancelWorkflow() stops all in-flight and queued nodes | Signal must propagate within grace period |
| Integration — back-pressure | Saturate queue; verify Resolver pauses; verify recovery | |
| Stress — 10,000 node graph | Linear throughput; no deadlock; no memory leak | 30-minute soak test in CI |
| Regression (v1.0.0 baseline) | 0 new failures | Via feature flag; all existing workloads |
| Performance | All §5.4 targets met | Benchmark suite runs on every merge |

### Definition of Done

- [ ] All tasks above marked complete
- [ ] `ExecutionEngine` and `NodeExecutor` interfaces frozen
      — no further changes without a new RFC
- [ ] All open questions in §6 resolved
- [ ] Panic recovery wrapper tested with deliberate crashes
- [ ] Live stream contract verified against M1.4 stub
- [ ] Performance benchmarks green in CI
- [ ] `RELEASE_NOTES.md` entry drafted for M1.3
- [ ] DRI sign-off recorded in §8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC draft created.
  BLOCKED on RFC-0002 reaching `accepted`.
  NodeReadyEvent and ResolverInboundEvent contracts
  must be frozen (RFC-0002 §3.2) before implementation.
  Open questions in §6 require DRI resolution before
  moving to in-review.
  M1.4 (DAG Visualizer) is blocked on the live stream
  contract (§3.2 ExecutionStreamEvent) being frozen.
  M1.5 (Conditional Branching) is blocked on the
  dispatch interface (§3.2 ExecutionEngine.dispatch)
  being frozen.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review
  RFC-0002 is accepted. Open questions resolved for
  Phase 1 alpha: in-process worker pool, back-pressure
  states OPEN/PRESSURED/SATURATED, ExecutionStreamEvent
  frozen for M1.4 consumer.

2026-09-09 | Bell Corporate Labs | Status: in-review → accepted
  Design approved. Linked to milestone: M1.3.
  Sign-off directed by the DRI in session; agent recorded
  the entry and did not self-approve.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0001 — DAG Compiler | `docs/rfcs/0001-dag-compiler.md` |
| RFC-0002 — Dependency Resolver | `docs/rfcs/0002-dependency-resolver.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Master roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0003 · Parallel Execution Engine · M1.3 · Phase 1*
