---
label: RFC:DAG-VISUALIZER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0004"
title: "Implement the Smartware DAG Visualizer — Live and Historical Trace Inspection as a Daemon Sidecar"
status: draft
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: ""
phase: 1
milestone: "M1.4"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: "RFC-0003 (docs/rfcs/0003-parallel-execution-engine.md)"
---

# RFC-0004 — DAG Visualizer Beta

> **Status:** `draft`
> **DRI:** _assign before moving to in-review_
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.4 — DAG Visualizer Beta (February 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. BLOCKED: This RFC depends on RFC-0003 reaching `accepted`
   and the ExecutionStreamEvent / onStreamEvent contracts
   being frozen. Do not implement any scope here until BOTH
   conditions are met and §8 contains a DRI sign-off.

2. All live-stream types are defined in RFC-0003 §3.2.
   Resolver snapshot types are defined in RFC-0002 §3.2.
   The compiled graph shape is defined in RFC-0001 §3.2.
   Import them — do not redefine or fork them.

3. The Visualizer MUST NOT calculate graph topology.
   Edges and batches come from ResolvedExecutionGraph.
   Live status comes from Resolver.snapshot() and
   ExecutionStreamEvent. Never infer an edge the compiler
   did not emit.

4. M1.4 ships CLI-only. The web UI is a stretch goal
   and MUST NOT block the milestone. See the Phase 1
   risk register (DAG Visualizer scope creep).

5. The Visualizer is a sidecar to the main daemon. It
   must not share the Engine worker pool or block
   node dispatch.

6. Telemetry is local-only. No external endpoint is
   contacted by default (docs/AI_INSTRUCTIONS.md § 2).

7. This RFC does not gate M1.5 (Conditional Branching).
   M1.5 is blocked on RFC-0003 dispatch, not on this
   Visualizer. The Visualizer must tolerate unknown
   node kinds added later without a schema break.
```

---

## § 1 — Summary

This RFC defines the Smartware DAG Visualizer — a developer-facing
sidecar that inspects live and historical DAG execution traces.
It is a **consumer**, not an authority. Topology is taken from
the frozen `ResolvedExecutionGraph` (RFC-0001). Node lifecycle
is taken from `DependencyResolver.snapshot()` (RFC-0002). Dispatch
and worker activity are taken from `ExecutionStreamEvent`
(RFC-0003). The Visualizer never invents edges, never repairs
cycles, and never talks to an external collector unless the
customer opts in.

M1.4 ships a CLI (`smartware inspect --live` and historical
replay). A web UI is stretch only and is out of the Beta
definition of done.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

v1.0.0 GA exposes `smartware inspect` against a linear queue.
There is no dependency graph, no live node-state view, and no
way to replay a run. Once the Resolver and Engine are wired
(RFC-0002 / RFC-0003), operators still cannot see which batch
is running, which branch failed, or why a node is `PENDING`.

### 2.2 Desired Outcome

A sidecar inspector that:
- Renders the compiled graph (batches from `executionOrder`)
- Overlays live `NodeState` from the Resolver
- Tails `ExecutionStreamEvent` without adding dispatch latency
- Replays a locally stored run log for historical inspection
- Ships as CLI at M1.4; web UI remains stretch

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.4 |
| Milestone Name | DAG Visualizer Beta |
| Target Date | February 2027 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Blocked By | M1.3 — Parallel Execution Engine (RFC-0003) |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  ResolvedExecutionGraph (RFC-0001)
          │  topology only — batches + edges
          ▼
  ┌──────────────────────────────────┐
  │         Trace Accumulator        │
  │                                  │
  │  Holds graph + latest snapshot   │
  │  + ordered stream events.        │
  │  Never derives new edges.        │
  └──────────┬───────────────────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
  Resolver.snapshot()   Engine.onStreamEvent()
  (RFC-0002)            (RFC-0003 ExecutionStreamEvent)
     │                │
     └───────┬────────┘
             ▼
  ┌──────────────────────────────────┐
  │         Render Adapter           │
  │                                  │
  │  CLI (M1.4 required):            │
  │    smartware inspect --live      │
  │    smartware inspect --trace     │
  │  Web UI (stretch): local page    │
  │    served by the sidecar only    │
  └──────────────────────────────────┘
             │
             ▼
  Local trace log (append-only file)
  Default path: customer-controlled.
  No remote write.
```

The Visualizer process (or in-process sidecar) subscribes to
the Engine live stream and periodically reads Resolver
snapshots. It does not call `dispatch()`, does not mutate
`NodeState`, and does not share the worker pool.

### 3.2 Interface / API Contract

Types from RFC-0001, RFC-0002, and RFC-0003 are imported,
not redefined.

```typescript
import type { ResolvedExecutionGraph } from './dagCompiler';
import type {
  NodeState,
  ResolverNodeRecord,
} from './dependencyResolver';
import type {
  ExecutionStreamEvent,
  EngineSnapshot,
} from './executionEngine';

// ── Visualizer view model ──────────────────────────────
// Derived only from frozen upstream contracts.

export interface VisualizerNodeView {
  nodeId: string;
  type: string;
  batchIndex: number;
  dependsOn: string[];
  dependents: string[];
  state: NodeState;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VisualizerEdgeView {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface VisualizerFrame {
  workflowId: string;
  compiledAt: string;
  capturedAt: string;            // ISO 8601
  nodes: Record<string, VisualizerNodeView>;
  edges: VisualizerEdgeView[];   // exactly the compiler edges
  batches: string[][];           // copy of executionOrder
  engine?: EngineSnapshot;
}

// ── Trace log (historical) ─────────────────────────────

export interface TraceHeader {
  workflowId: string;
  runId: string;
  compilerVersion: string;
  recordedAt: string;
  graph: ResolvedExecutionGraph;
}

export type TraceRecord =
  | { kind: 'header'; header: TraceHeader }
  | { kind: 'snapshot'; capturedAt: string; nodes: Record<string, ResolverNodeRecord> }
  | { kind: 'stream'; event: ExecutionStreamEvent; capturedAt: string }
  | { kind: 'end'; capturedAt: string; terminal: 'COMPLETED' | 'FAILED' | 'CANCELLED' };

// ── Sidecar API ────────────────────────────────────────

export interface VisualizerConfig {
  liveRefreshMs: number;         // snapshot poll interval; default 200
  traceLogPath?: string;         // local file; unset = no historical log
  maxTraceBytes?: number;        // default 64 MiB; fail-closed when exceeded
}

export interface DagVisualizer {
  /**
   * Bind to a compiled graph. Topology is frozen at bind time.
   * Subsequent live updates may only change node state, never
   * add or remove edges.
   */
  bind(graph: ResolvedExecutionGraph, config: VisualizerConfig): void;

  /**
   * Apply a Resolver snapshot. Unknown node IDs are ignored
   * and counted as dropped (fail-closed: do not invent nodes).
   */
  applySnapshot(nodes: Record<string, ResolverNodeRecord>): void;

  /**
   * Apply one ExecutionStreamEvent. Events for unknown node
   * IDs are dropped. WORKER_IDLE / BACK_PRESSURE_CHANGED
   * update engine overlay only.
   */
  applyStreamEvent(event: ExecutionStreamEvent): void;

  /**
   * Current render frame. Pure read; does not mutate state.
   */
  frame(): VisualizerFrame;

  /**
   * Replay a local trace log into frames. Does not contact
   * the live Engine or Resolver.
   */
  replay(records: TraceRecord[]): VisualizerFrame[];
}

// ── CLI surface (M1.4 required) ────────────────────────

// smartware inspect --live [--workflow <id>]
// smartware inspect --trace <path> [--follow]
```

The CLI is a thin wrapper over `DagVisualizer`. `--live` attaches
to the running daemon sidecar. `--trace` reads an append-only
local log. Neither command accepts a remote URL.

### 3.3 Data Flow

1. CLI or sidecar calls `visualizer.bind(graph, config)` with
   the same `ResolvedExecutionGraph` the Resolver was `init`'d
   with.
2. Accumulator copies `executionOrder` into `batches` and
   builds `edges` from each node's `dependsOn` list. No other
   edge source is permitted.
3. Sidecar registers `engine.onStreamEvent(applyStreamEvent)`
   and polls `resolver.snapshot()` on `liveRefreshMs`.
4. Each snapshot/stream event updates `VisualizerNodeView.state`
   (and attempts / timestamps) for **known** node IDs only.
5. If `traceLogPath` is set, the sidecar appends `TraceRecord`
   lines locally. When `maxTraceBytes` is exceeded, logging
   stops and a local error is surfaced — the run continues.
6. `smartware inspect --live` prints a text frame (batch
   columns + per-node state) on each refresh.
7. `smartware inspect --trace <path>` replays records in
   order via `replay()`.

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Stream event for unknown node ID | Drop event; increment local drop counter; do not add a node | Bind the matching compiled graph |
| Snapshot contains unknown node ID | Ignore that record; do not merge it into the frame | Same as above |
| `bind()` called twice with a different graph | Reject; require explicit `bind()` after teardown | Restart inspect session |
| Trace log exceeds `maxTraceBytes` | Stop appending; keep live view; surface `TRACE_LOG_FULL` | Rotate or raise the cap |
| Trace log unreadable / truncated | `replay()` returns no frames and a typed error; never partial-guess topology | Re-run with a complete log |
| Sidecar cannot attach to daemon | CLI exits non-zero; Engine and Resolver are unaffected | Start the daemon first |
| Web UI stretch not built | Not a Beta failure — CLI is the M1.4 contract | Defer UI to a later RFC |

The Visualizer **never** mutates workflow state. A Visualizer
crash must not fail the run.

### 3.5 Idempotency Guarantees

- `applySnapshot()` is last-write-wins per `nodeId`. Applying
  the same snapshot twice yields the same `frame()`.
- `applyStreamEvent()` is ordered by arrival. Duplicate
  `NODE_DISPATCHED` / `NODE_COMPLETED` pairs for the same
  `nodeId` + `attempt` do not create extra edges or nodes.
- `replay()` is a pure function of the `TraceRecord[]` input.
- Trace log writes are append-only. The Visualizer does not
  rewrite historical records.

---

## § 4 — Alternatives Considered

### Option A — Visualizer owns topology (Rejected)

**Summary:** Build an adjacency list from live events only
(`NODE_DISPATCHED` implies an edge).

**Reason rejected:** The Engine stream does not carry edges.
Inferring topology from dispatch order would invent edges the
compiler never emitted and would desync from
`ResolvedExecutionGraph`. Violates fail-closed: ambiguity
must halt the view, not guess a graph.

### Option B — Web canvas as M1.4 GA (Rejected for Beta)

**Summary:** Ship a Canvas/React inspector as the Beta
deliverable (60 FPS layout, custom layout engine).

**Reason rejected:** Phase 1 risk register rates Visualizer
scope creep as High likelihood. CLI-only at M1.4 is the
explicit mitigation. A web UI remains stretch and requires
its own RFC if it becomes more than a local sidecar page.

### Option C — Remote trace collector by default (Rejected)

**Summary:** Ship traces to a central observability sink so
historical inspect works across machines.

**Reason rejected:** Ownerware tiebreaker and
`docs/AI_INSTRUCTIONS.md` § 2 — telemetry must default off and
stay inside the customer boundary. Historical inspect uses
a customer-controlled local file. External export is opt-in
and out of this RFC.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| DAG Compiler (RFC-0001) | None — input only | Topology from `ResolvedExecutionGraph` |
| Dependency Resolver (RFC-0002) | Minor | `snapshot()` already specified; poll only |
| Execution Engine (RFC-0003) | Minor | `onStreamEvent` already specified |
| CLI (`smartware inspect`) | Major | `--live` and `--trace` modes added |
| SDK | Minor | `DagVisualizer` + view types exported |
| v1.0.0 linear queue | None | Inspect on the queue path is unchanged |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| RFC-0001 frozen graph types | Internal | Topology |
| RFC-0002 `snapshot()` | Internal | NodeState overlay |
| RFC-0003 `ExecutionStreamEvent` | Internal | Live dispatch overlay |
| Local filesystem | Internal | Optional trace log; customer path |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — sidecar is local;
      no network client in the M1.4 CLI
- [x] **Telemetry is opt-in** — trace log is local and
      optional; no external endpoint
- [x] **Feature flags** — no billing or metering code
- [x] **Fail-closed** — unknown nodes are dropped, not
      invented; truncated traces are not guessed
- [x] **Idempotent** — snapshot apply and replay are
      deterministic
- [x] **mTLS** — N/A (Phase 1; single-node sidecar)

### 5.4 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Sidecar apply latency per stream event | < 1 ms | Microbenchmark in CI |
| `frame()` at 10,000 nodes | < 20 ms | Stress test in CI |
| Live CLI refresh | ≥ 5 Hz without blocking Engine dispatch | Integration test |
| Engine dispatch regression with sidecar attached | 0 ms budget stolen from worker pool | Compare RFC-0003 benchmarks |

### 5.5 Rollback Plan

The Visualizer is additive in M1.4. The Engine and Resolver
do not depend on it.

If the Visualizer is found to be incorrect post-merge:
1. Operators stop using `smartware inspect --live` / `--trace`
2. Optionally disable sidecar attach via
   `SMARTWARE_DAG_VISUALIZER=0` (defaults to `1` after M1.4)
3. `SMARTWARE_DAG_COMPILER=0` still reverts the whole DAG
   path to the v1.0.0 queue (RFC-0001 §5.5)
4. No data loss — traces are optional local files
5. File bug against RFC-0004; fix in patch release

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | Default `liveRefreshMs`: 200 ms proposed. Is that too chatty for 10k-node snapshots? | Bell Corporate Labs | TBD | ☐ |
| 2 | Should `--live` use snapshot poll only, stream only, or both? Both proposed so `PENDING` vs `READY` is visible before dispatch | Bell Corporate Labs | TBD | ☐ |
| 3 | Trace log format: NDJSON of `TraceRecord` vs a single JSON document? NDJSON proposed for append-only crash safety | Bell Corporate Labs | TBD | ☐ |
| 4 | Is a local web page (stretch) allowed to bind loopback only, or is CLI the only process that may render? | Bell Corporate Labs | TBD | ☐ |
| 5 | Should historical inspect require the original `ResolvedExecutionGraph` in the trace header, or may a separate compile artifact be supplied? Header-embedded graph proposed | Bell Corporate Labs | TBD | ☐ |

---

## § 7 — Implementation Plan

> [HUMAN REQUIRED] — Do not populate until RFC status
> is `accepted` and §8 contains a DRI sign-off.

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| `DagVisualizer.bind` + edge copy from graph | TBD | TBD | M1.4 |
| `applySnapshot` / `applyStreamEvent` | TBD | TBD | M1.4 |
| `frame()` text renderer for CLI | TBD | TBD | M1.4 |
| Sidecar attach to Engine `onStreamEvent` | TBD | TBD | M1.4 |
| Optional local trace log writer | TBD | TBD | M1.4 |
| `replay()` + `smartware inspect --trace` | TBD | TBD | M1.4 |
| `smartware inspect --live` | TBD | TBD | M1.4 |
| `SMARTWARE_DAG_VISUALIZER` flag | TBD | TBD | M1.4 |
| SDK export of view types | TBD | TBD | M1.4 |
| Web UI sidecar page | TBD | TBD | M1.4 stretch |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit — unknown node drop | Stream + snapshot unknown IDs never appear in `frame()` | |
| Unit — edge set equals compiler | `edges` isomorphic to `dependsOn` | |
| Unit — replay determinism | Same `TraceRecord[]` → same frames | |
| Integration — live attach | Sidecar does not call `dispatch()` | |
| Integration — Engine benchmarks | No regression vs RFC-0003 §5.4 with sidecar on | |
| Regression (v1.0.0 baseline) | 0 new failures | Inspect on queue path unchanged |
| Stretch — web UI | Not required for M1.4 Beta | |

### Definition of Done

- [ ] CLI `--live` and `--trace` documented and passing
- [ ] Web UI **not** required
- [ ] All open questions in §6 resolved
- [ ] `DagVisualizer` interface frozen — further changes need a new RFC
- [ ] `RELEASE_NOTES.md` entry drafted for M1.4
- [ ] DRI sign-off recorded in §8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC draft created.
  BLOCKED on RFC-0003 reaching `accepted`.
  ExecutionStreamEvent and onStreamEvent contracts
  must be frozen (RFC-0003 §3.2) before implementation.
  Open questions in §6 require DRI resolution before
  moving to in-review.
  M1.4 Beta is CLI-only; web UI is stretch.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0001 — DAG Compiler | `docs/rfcs/0001-dag-compiler.md` |
| RFC-0002 — Dependency Resolver | `docs/rfcs/0002-dependency-resolver.md` |
| RFC-0003 — Parallel Execution Engine | `docs/rfcs/0003-parallel-execution-engine.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Master roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0004 · DAG Visualizer Beta · M1.4 · Phase 1*
