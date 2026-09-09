---
label: RFC:DEPENDENCY-RESOLVER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0002"
title: "Implement the Smartware Dependency Resolver — Node State Tracking, Downstream Triggering, and Retry Semantics"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 1
milestone: "M1.2"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: "RFC-0001 (docs/rfcs/0001-dag-compiler.md)"
---

# RFC-0002 — Dependency Resolver v1

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.2 — Dependency Resolver v1 (November 2026)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. Status is ACCEPTED. §3.2 is frozen. RFC-0001 is accepted.
   Do NOT implement M1.2 until M1.1 cycle detection exists
   and passes (docs/AI_INSTRUCTIONS.md § 3). This freeze
   does not authorise Execution Engine (M1.3) scaffolding.

2. All input types (ResolvedExecutionGraph, ResolvedNode,
   RetryPolicy) are defined in RFC-0001 §3.2. Import them;
   do not redefine or fork them.

3. The Resolver is stateful. Every state transition must be
   idempotent — the same event delivered twice must produce
   the same state as delivering it once.

4. Fail-closed: if the Resolver cannot determine a node's
   state with certainty, it must halt that execution branch
   (not the whole workflow) and surface RESOLVER_STATE_AMBIGUOUS.
   It must NOT guess or assume a node succeeded.

5. Retry logic must never produce duplicate side effects.
   Idempotency keys are required for all node executions
   before retry is permitted on a node.

6. This RFC gates M1.3 (Parallel Execution Engine).
   The Execution Engine consumes NodeReadyEvents emitted
   by this Resolver. Do not scaffold the Engine until
   M1.1 cycle detection is passing AND this contract is
   used as specified.

7. M1.2 is in-memory only. Durable state is an M1.6 gate
   (see §6 Q5). Do not design a store in this RFC.
```

---

## § 1 — Summary

This RFC defines the Smartware Dependency Resolver — the
stateful runtime component that sits between the DAG
Compiler output and the Execution Engine. It owns the
lifecycle of every node within a running workflow: tracking
state transitions, evaluating whether a node's dependencies
are satisfied, triggering downstream nodes, enforcing retry
policies, propagating timeouts, and isolating partial
failures so that a single failing branch does not
unnecessarily terminate healthy siblings.

The Resolver is the central authority on workflow execution
state. No node transitions to a new state without the
Resolver recording and authorising that transition.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

The v1.0.0 linear queue has no dependency graph concept.
Tasks run sequentially. There is no mechanism to:
- Know when a task's upstream dependencies have completed
- Trigger downstream work automatically
- Retry failed tasks with configurable back-off
- Propagate a timeout set on one task to its dependents
- Allow independent branches to continue when one branch fails

### 2.2 Desired Outcome

A stateful Dependency Resolver that:
- Accepts a `ResolvedExecutionGraph` from the DAG Compiler
- Tracks the `NodeState` of every node in the graph
- Evaluates dependency satisfaction on every state change
- Emits `NodeReadyEvent` to the Execution Engine when a
  node's dependencies are fully satisfied
- Enforces `RetryPolicy` on failed nodes
- Propagates timeouts down dependency chains
- Isolates branch failures according to the workflow's
  configured `FailurePolicy`

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.2 |
| Milestone Name | Dependency Resolver v1 |
| Target Date | November 2026 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Blocked By | M1.1 — DAG Compiler Alpha (RFC-0001) |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  ResolvedExecutionGraph (from RFC-0001 §3.2)
          │
          ▼
  ┌────────────────────────┐
  │   Resolver.init()      │  Bootstraps NodeState map.
  │                        │  All nodes start as PENDING.
  │                        │  Entrypoints transition to
  │                        │  READY immediately.
  └──────────┬─────────────┘
             │  emits NodeReadyEvent(s)
             ▼
  ┌────────────────────────┐       ┌─────────────────────┐
  │   Execution Engine     │──────▶│  Node Executor      │
  │   (M1.3 consumer)      │       │  (runs the work)    │
  └──────────┬─────────────┘       └────────┬────────────┘
             │  NodeStartedEvent             │
             │◀──────────────────────────────┤
             │  NodeSucceededEvent           │
             │◀──────────────────────────────┤
             │  NodeFailedEvent              │
             │◀──────────────────────────────┘
             │
             ▼
  ┌────────────────────────┐
  │  State Transition      │  Validates event against
  │  Handler               │  current NodeState.
  │                        │  Rejects illegal transitions.
  │                        │  Writes new state atomically.
  └──────────┬─────────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
  ┌──────────┐  ┌─────────────────────────────┐
  │  Retry   │  │  Dependency Evaluator        │
  │  Handler │  │                              │
  │          │  │  For each dependent node:    │
  │  Applies │  │  - Check all dependsOn nodes │
  │  backoff │  │    are in terminal state     │
  │  re-emits│  │  - If all SUCCEEDED → READY  │
  │  READY   │  │  - If any FAILED and policy  │
  └──────────┘  │    is HALT → SKIPPED         │
                │  - If policy is CONTINUE →   │
                │    emit READY anyway         │
                └──────────────────────────────┘
                             │
                             ▼
                    NodeReadyEvent (next wave)
                    or WorkflowCompletedEvent
                    or WorkflowFailedEvent
```

### 3.2 Interface / API Contract

All types from RFC-0001 §3.2 are imported, not redefined.

```typescript
import type {
  ResolvedExecutionGraph,
  ResolvedNode,
  RetryPolicy,
} from './dagCompiler';

// ── Node State Machine ─────────────────────────────────

export type NodeState =
  | 'PENDING'     // waiting for dependencies to complete
  | 'READY'       // all dependencies met; queued for execution
  | 'RUNNING'     // execution engine has started this node
  | 'SUCCEEDED'   // node completed successfully
  | 'FAILED'      // node failed; retry budget exhausted
  | 'RETRYING'    // node failed; retry in progress
  | 'TIMED_OUT'   // node exceeded its timeout
  | 'SKIPPED'     // skipped due to upstream failure + HALT policy
  | 'CANCELLED';  // workflow cancelled mid-flight

// Legal state transitions (all others are rejected):
//
//   PENDING   → READY
//   READY     → RUNNING
//   RUNNING   → SUCCEEDED | FAILED | TIMED_OUT | CANCELLED
//   FAILED    → RETRYING  (if retry budget remains)
//   RETRYING  → RUNNING   (on next attempt)
//   RETRYING  → FAILED    (if budget exhausted mid-retry)
//   PENDING   → SKIPPED   (upstream FAILED + HALT policy)
//   READY     → CANCELLED
//   RUNNING   → CANCELLED

// ── Failure Policies ───────────────────────────────────

export type FailurePolicy =
  | 'HALT'      // on any node failure, skip all dependents
  | 'CONTINUE'; // on node failure, continue independent branches

// ── Events (inbound to Resolver) ──────────────────────

export type ResolverInboundEvent =
  | { type: 'NODE_STARTED';   nodeId: string; executionId: string; startedAt: string  }
  | { type: 'NODE_SUCCEEDED'; nodeId: string; executionId: string; completedAt: string; output?: unknown }
  | { type: 'NODE_FAILED';    nodeId: string; executionId: string; failedAt: string;   error: string     }
  | { type: 'NODE_TIMED_OUT'; nodeId: string; executionId: string; timedOutAt: string  }
  | { type: 'WORKFLOW_CANCEL'; requestedAt: string };

// ── Events (outbound from Resolver) ───────────────────

export type ResolverOutboundEvent =
  | {
      type: 'NODE_READY';
      nodeId: string;
      node: ResolvedNode;
      idempotencyKey: string;   // required; executor must echo this back
      attempt: number;          // 1-based; >1 means retry
      timeoutDeadline: string;  // ISO 8601; absolute deadline for this attempt
    }
  | {
      type: 'WORKFLOW_COMPLETED';
      workflowId: string;
      completedAt: string;
      nodeStates: Record<string, NodeState>;
    }
  | {
      type: 'WORKFLOW_FAILED';
      workflowId: string;
      failedAt: string;
      failedNodes: string[];
      nodeStates: Record<string, NodeState>;
    }
  | {
      type: 'RESOLVER_STATE_AMBIGUOUS';
      nodeId: string;
      reason: string;
      // Halt only this node and its downstream dependents.
      // Independent siblings continue per failurePolicy.
    };

// ── Resolver Node Record ───────────────────────────────

export interface ResolverNodeRecord {
  nodeId: string;
  state: NodeState;
  attempts: number;           // how many execution attempts so far
  lastExecutionId?: string;   // idempotency tracking
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  timeoutDeadline?: string;
}

// ── Resolver Config ────────────────────────────────────

export interface ResolverConfig {
  failurePolicy: FailurePolicy;    // default: 'HALT'
  maxGlobalTimeout?: number;       // ms; hard wall clock for entire workflow
  jitterSeed?: number;             // optional; if omitted, derived from workflowId
}

// ── Resolver API ───────────────────────────────────────

export interface DependencyResolver {
  /**
   * Initialise the Resolver from a compiled graph.
   * Sets all nodes to PENDING; immediately evaluates
   * entrypoints and emits NodeReadyEvent(s) for them.
   * Idempotent: calling init() twice on the same graph
   * is a no-op after the first call.
   */
  init(
    graph: ResolvedExecutionGraph,
    config: ResolverConfig,
  ): ResolverOutboundEvent[];

  /**
   * Feed an inbound event into the Resolver.
   * Returns zero or more outbound events as a result
   * of the state transition. Never throws.
   * WORKFLOW_CANCEL is a thin alias for cancel() under
   * the same mutex.
   */
  handle(event: ResolverInboundEvent): ResolverOutboundEvent[];

  /**
   * Canonical cancel. Transitions PENDING/READY to CANCELLED,
   * marks RUNNING as CANCELLED (Engine must abort), emits
   * WORKFLOW_FAILED. Serialised on the same per-workflow mutex
   * as handle(). Idempotent after the first successful cancel.
   */
  cancel(): ResolverOutboundEvent[];

  /**
   * Snapshot the current state of all nodes.
   * Returns a deep copy. Callers must not assume they can
   * mutate resolver internals through this object.
   */
  snapshot(): Record<string, ResolverNodeRecord>;
}
```

### 3.3 Data Flow

1. Caller invokes `resolver.init(graph, config)`
2. Resolver creates a `ResolverNodeRecord` for every node,
   all initialised to `PENDING`
3. Resolver identifies entrypoint nodes (nodes with empty
   `dependsOn`) and transitions them to `READY`, emitting
   a `NODE_READY` event for each with:
   - A freshly generated `idempotencyKey` (UUID v4)
   - `attempt: 1`
   - `timeoutDeadline` calculated from `node.timeout` and
     the current wall clock
4. Execution Engine receives `NODE_READY` events, starts
   work, feeds `NODE_STARTED` back to Resolver
5. On `NODE_STARTED`: Resolver transitions node to
   `RUNNING`. Illegal transition (e.g. node not in `READY`)
   is rejected with `RESOLVER_STATE_AMBIGUOUS`
6. On `NODE_SUCCEEDED`: Resolver transitions node to
   `SUCCEEDED`, then runs the **Dependency Evaluator**:
   - For each node in `dependents`:
     - Fetch its `dependsOn` list
     - Check whether all are in a terminal state
       (`SUCCEEDED`, `SKIPPED`)
     - If yes → transition dependent to `READY`, emit
       `NODE_READY`
     - If no → leave as `PENDING`
7. On `NODE_FAILED`:
   - If `attempts < retryPolicy.maxAttempts`:
     - Transition to `RETRYING`
     - Schedule retry after back-off delay
       (`backoffMs * backoffMultiplier ^ (attempts - 1)`)
     - On retry: transition to `READY`, emit `NODE_READY`
       with incremented `attempt` and new `idempotencyKey`
   - If `attempts >= retryPolicy.maxAttempts`:
     - Transition to `FAILED`
     - Run Dependency Evaluator with failure context:
       - If `failurePolicy == HALT`: transition all
         downstream dependents (recursively) to `SKIPPED`
       - If `failurePolicy == CONTINUE`: evaluate dependents
         normally — those with all other deps satisfied
         still proceed
     - If no non-SKIPPED nodes remain → emit
       `WORKFLOW_FAILED`
8. On `NODE_TIMED_OUT`:
   - Treated identically to `NODE_FAILED` for retry and
     dependency evaluation purposes
   - State stored as `TIMED_OUT`, not `FAILED`, for
     observability distinction
9. On `WORKFLOW_CANCEL` / `cancel()`:
   - `handle({ type: 'WORKFLOW_CANCEL' })` calls `cancel()`
   - Transition all `PENDING` and `READY` nodes to
     `CANCELLED`
   - `RUNNING` nodes are marked `CANCELLED`; Execution
     Engine is responsible for aborting them
   - Emit `WORKFLOW_FAILED` with cancellation reason
10. When all nodes reach a terminal state
    (`SUCCEEDED`, `FAILED`, `TIMED_OUT`, `SKIPPED`,
    `CANCELLED`): emit `WORKFLOW_COMPLETED` if zero
    nodes are in `FAILED` or `TIMED_OUT` state,
    otherwise emit `WORKFLOW_FAILED`

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Illegal state transition | Reject event; emit `RESOLVER_STATE_AMBIGUOUS`; halt **affected branch only** (`nodeId` + downstream dependents not READY). Independent siblings follow `failurePolicy` | Operator inspects snapshot; manual resolution or workflow restart |
| `idempotencyKey` mismatch on inbound event | Reject event; emit `RESOLVER_STATE_AMBIGUOUS`; same branch-only halt | Executor must echo back the exact key issued by Resolver |
| Retry budget exhausted | Node → `FAILED`; downstream policy applied | Inspect logs; fix root cause; restart workflow |
| Global timeout exceeded | All non-terminal nodes → `TIMED_OUT` or `CANCELLED`; `WORKFLOW_FAILED` emitted | Increase `maxGlobalTimeout` or break workflow into smaller graphs |
| Resolver called before `init()` | Return `RESOLVER_STATE_AMBIGUOUS` immediately | Caller must call `init()` first |
| Duplicate `NODE_SUCCEEDED` for same `executionId` | Idempotent — second event is a no-op; no state change | Safe by design |

### 3.5 Idempotency Guarantees

- Every `NODE_READY` emission carries a unique
  `idempotencyKey`. The Execution Engine must echo this
  key back in `NODE_STARTED`, `NODE_SUCCEEDED`, and
  `NODE_FAILED` events.
- If the Resolver receives a duplicate event for the same
  `executionId` + `idempotencyKey`, it is a no-op.
- Receiving the same `NODE_SUCCEEDED` twice for the same
  node does not trigger a second round of dependency
  evaluation.
- `handle()` is safe to call concurrently; internal state
  mutations are serialised behind a per-workflow lock.
  The return value of `handle()` reflects only the events
  produced by that specific call.
- `cancel()` uses that same lock. `handle(WORKFLOW_CANCEL)`
  is an alias and does not race a parallel `cancel()`.
- `snapshot()` returns a deep copy. Mutating the returned
  object must not change resolver state.

### 3.6 Retry Back-Off Calculation

```
delay(attempt) = backoffMs * (backoffMultiplier ^ (attempt - 1))

Example (backoffMs=100, backoffMultiplier=2, maxAttempts=4):
  Attempt 1 → execute immediately
  Attempt 2 → wait  100ms
  Attempt 3 → wait  200ms
  Attempt 4 → wait  400ms
  → budget exhausted → FAILED
```

Back-off is jittered ±10% to prevent thundering herd
when multiple nodes fail simultaneously. Jitter uses a
**per-workflow seeded PRNG**. Seed is `config.jitterSeed`
when set; otherwise derived from `workflowId`. Same graph
+ seed → same jitter sequence (tests must pass a seed).

---

## § 4 — Alternatives Considered

### Option A — Event-sourced append-only log (Rejected)

**Summary:** Store all state as an append-only event log;
derive current `NodeState` by replaying from the beginning
on every query.

**Reason rejected:** Replay cost grows with workflow size
and run duration. For a 10,000-node graph with many
transitions, replay latency would violate the < 5ms
node transition overhead target from Phase 1 success
metrics. A materialised state map with event log as
optional audit side-channel is the right trade-off at
this scale.

### Option B — Push all retry logic into the Execution Engine (Rejected)

**Summary:** The Execution Engine owns retry — Resolver
only tracks state, never schedules re-execution.

**Reason rejected:** Splits the authoritative source of
truth for retry state across two components. The Resolver
must know the attempt count to correctly apply
`maxAttempts` and generate correct `idempotencyKey`
values. Keeping retry logic in the Resolver ensures a
single component owns the full lifecycle of a node
execution.

### Option C — Per-node actor/goroutine model (Deferred)

**Summary:** Each node gets its own goroutine/actor that
manages its own state machine independently.

**Reason rejected for M1.2:** Introduces significant
coordination complexity and makes `snapshot()` harder
to implement correctly. Deferred as a potential Phase 2
or M1.3 optimisation if the centralised lock becomes a
bottleneck under high concurrency. A note will be added
to the Phase 2 backlog.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| DAG Compiler (RFC-0001) | None — input only | Consumes `ResolvedExecutionGraph`; does not modify it |
| Execution Engine (M1.3) | Major — primary consumer | Engine receives `NODE_READY`; feeds events back |
| DAG Visualizer (M1.4) | Minor | Visualizer can consume `snapshot()` for live state display |
| CLI (`smartware run`) | Minor | Surfaces `WORKFLOW_COMPLETED` / `WORKFLOW_FAILED` exit codes |
| SDK | Moderate | `ResolverInboundEvent` and `ResolverOutboundEvent` types exported |
| v1.0.0 linear queue | None | Queue remains behind feature flag; Resolver is additive |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| RFC-0001 frozen types | Internal | `ResolvedExecutionGraph`, `ResolvedNode`, `RetryPolicy` |
| UUID v4 generator | Internal | `idempotencyKey` generation; no external package needed |
| Per-workflow mutex | Internal | Serialise `handle()` calls; stdlib only |
| Monotonic clock | Internal | Back-off scheduling and timeout deadlines |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — Resolver is
      in-process; no network calls
- [x] **Telemetry is opt-in** — state transitions
      available via local instrumentation hook only;
      no external sink
- [x] **Fail-closed** — ambiguous state emits
      `RESOLVER_STATE_AMBIGUOUS`; never assumes success
- [x] **Idempotent** — duplicate events are no-ops;
      `idempotencyKey` enforced end-to-end
- [x] **Feature flags** — no billing or metering code
- [x] **mTLS** — N/A (Phase 1; single-node)

### 5.4 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| State transition latency | < 5 ms per event | Microbenchmark in CI |
| `snapshot()` latency (10k nodes) | < 10 ms | Benchmark with max-size graph |
| Memory per node record | < 512 bytes | Heap profiler |
| Retry scheduling jitter accuracy | ±10% of computed delay | Timer test suite |

### 5.5 Rollback Plan

The Resolver is additive in M1.2. The v1.0.0 linear queue
remains fully operational behind `SMARTWARE_DAG_COMPILER=0`
feature flag (established in RFC-0001 §5.5).

If the Resolver is found to be incorrect post-merge:
1. Set `SMARTWARE_DAG_COMPILER=0` — reverts to v1.0.0
   linear queue; Resolver is never called
2. No data loss risk — Resolver holds only in-memory
   state for the duration of a workflow run
3. File bug against RFC-0002; fix in patch release

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | Should `RESOLVER_STATE_AMBIGUOUS` pause only the affected branch or the entire workflow? | Bell Corporate Labs | Halt **affected branch only** (`nodeId` + downstream dependents). Independent siblings follow `failurePolicy`. | ☑ |
| 2 | Does back-off jitter use a seeded PRNG (for reproducibility in tests) or true randomness? | Bell Corporate Labs | Per-workflow seeded PRNG. Optional `jitterSeed` on `ResolverConfig`; default derived from `workflowId`. | ☑ |
| 3 | Should `snapshot()` return a deep copy or a read-only view? | Bell Corporate Labs | Deep copy. Callers must not mutate live resolver state. | ☑ |
| 4 | Is `WORKFLOW_CANCEL` a first-class inbound event or a method on `DependencyResolver`? | Bell Corporate Labs | Canonical API is `cancel()`. `handle({ type: 'WORKFLOW_CANCEL' })` is a thin alias on the same mutex. | ☑ |
| 5 | What is the persistence story for Resolver state? M1.2 is in-memory only — but if the process restarts mid-workflow, all state is lost. Is that acceptable for Phase 1? | Bell Corporate Labs | **M1.2 Alpha:** in-memory only. Process restart loses the run; that is accepted for Alpha. **M1.6 GA:** durable resolver state is a hard gate. M1.6 cannot be signed off while runs are crash-lossy. Persistence requires its own RFC before M1.6; this RFC does not design the store. | ☑ |

---

## § 7 — Implementation Plan

> Populated after DRI accepted this RFC (2026-09-09).
> Do not start these tasks until M1.1 cycle detection exists
> and passes.

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| `NodeState` machine + legal transition table | Bell Corporate Labs | TBD | M1.2 |
| `ResolverNodeRecord` store + per-workflow mutex | Bell Corporate Labs | TBD | M1.2 |
| `init()` — bootstrap + entrypoint evaluation | Bell Corporate Labs | TBD | M1.2 |
| `handle()` — state transition handler | Bell Corporate Labs | TBD | M1.2 |
| `cancel()` + `WORKFLOW_CANCEL` alias | Bell Corporate Labs | TBD | M1.2 |
| Dependency Evaluator (HALT + CONTINUE policies) | Bell Corporate Labs | TBD | M1.2 |
| Retry handler + seeded-jitter back-off | Bell Corporate Labs | TBD | M1.2 |
| Timeout propagation + global timeout watchdog | Bell Corporate Labs | TBD | M1.2 |
| `snapshot()` deep copy | Bell Corporate Labs | TBD | M1.2 |
| Branch-only `RESOLVER_STATE_AMBIGUOUS` | Bell Corporate Labs | TBD | M1.2 |
| SDK export of all event types | Bell Corporate Labs | TBD | M1.2 |
| Idempotency key echo validation | Bell Corporate Labs | TBD | M1.2 |
| Performance benchmarks | Bell Corporate Labs | TBD | M1.2 |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit — state machine | Every legal transition has a test | Illegal transitions must be rejected |
| Unit — retry back-off | All `maxAttempts` values 1–10 tested | Including budget exhaustion |
| Unit — HALT vs CONTINUE policy | Both policies tested on every failure scenario | |
| Integration — full workflow run | Happy path + single failure + cascading failure | Via stub Execution Engine |
| Idempotency | Duplicate events at every state | Must produce no state change |
| Regression (v1.0.0 baseline) | 0 new failures | All existing workloads via feature flag path |
| Performance | Transition latency < 5ms; snapshot < 10ms | CI benchmark suite |

### Definition of Done

- [ ] All tasks above marked complete
- [ ] `DependencyResolver` interface frozen — no further
      changes without a new RFC
- [ ] All open questions in §6 resolved
- [ ] Idempotency validation passing for all event types
- [ ] Performance benchmarks green in CI
- [ ] `RELEASE_NOTES.md` entry drafted for M1.2
- [ ] DRI sign-off recorded in §8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC draft created.
  BLOCKED on RFC-0001 reaching `accepted`.
  Open questions in §6 require DRI resolution before
  moving to in-review.
  M1.3 (Parallel Execution Engine) is blocked on this
  RFC reaching `accepted` and NodeReadyEvent contract
  (§3.2) being frozen.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review
  Open questions in §6 resolved. AMBIGUOUS is branch-only.
  Jitter is seeded. snapshot() is a deep copy. cancel()
  is canonical; WORKFLOW_CANCEL is an alias.

2026-09-09 | Bell Corporate Labs | Status: in-review → accepted
  Design approved. Implementation of M1.2 must wait until
  M1.1 cycle detection exists and passes.
  Linked to milestone: M1.2
  Sign-off directed by the DRI in session; agent recorded
  the entry and did not self-approve.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0001 — DAG Compiler | `docs/rfcs/0001-dag-compiler.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Master roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0002 · Dependency Resolver v1 · M1.2 · Phase 1*
