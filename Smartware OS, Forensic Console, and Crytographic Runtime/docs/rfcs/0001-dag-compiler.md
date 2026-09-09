---
label: RFC:DAG-COMPILER-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0001"
title: "Implement the Smartware DAG Compiler — Static Analysis, Cycle Detection, and Topological Sort"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 1
milestone: "M1.1"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: "RFC-0006 (docs/rfcs/0006-plugin-api.md)"
---

# RFC-0001 — DAG Compiler Alpha

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.1 — DAG Compiler Alpha (October 2026)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. Status is ACCEPTED. §3.2 is frozen. Do not change the
   compile() contract without a new RFC. Implementation
   of M1.1 may begin.

2. This RFC gates M1.2 (Dependency Resolver). The Resolver
   cannot be wired until this contract is used as specified.

3. Cycle detection MUST be implemented and passing before
   the Parallel Execution Engine (M1.3) is scaffolded.
   See docs/AI_INSTRUCTIONS.md § 3, Phase 1 rules.

4. Fail-closed: the compiler rejects graphs with cycles.
   It does NOT attempt auto-repair or cycle breaking.

5. The DAG definition DSL (§3.2) is the SDK surface.
   Do not change it after M1.1 ships without a new RFC.

6. Node types come from RFC-0006 (`NodeTypeRegistry`).
   The compiler must not own or fork the registry.
```

---

## § 1 — Summary

This RFC proposes the design and implementation of the
Smartware DAG Compiler — the component that transforms
declarative workflow definitions written in the Smartware
DSL into validated, optimised execution graphs ready for
consumption by the runtime engine.

The compiler is the foundational deliverable of Phase 1.
Every subsequent Phase 1 component (Dependency Resolver,
Parallel Execution Engine, Visualizer, Conditional
Branching) depends on the graph representation and
output contract defined here. Getting this right at M1.1
is critical to Phase 1 schedule integrity.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

Smartware v1.0.0 GA executes tasks using a linear FIFO
queue. The scheduler has no concept of dependencies
between tasks. Workloads that are naturally parallel
must be artificially serialised. There is no static
validation of workflow definitions — malformed inputs
fail at runtime.

### 2.2 Desired Outcome

A compile step that accepts a declarative workflow
definition, validates its structure, detects cycles,
resolves the execution order, and emits a typed
`ResolvedExecutionGraph` ready for the runtime.
Errors surface at compile time, not at execution time.

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.1 |
| Milestone Name | DAG Compiler Alpha |
| Target Date | October 2026 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  Workflow Definition (DSL / YAML / JSON)
          │
          ▼
  ┌───────────────────┐
  │   DAG Parser      │  Parses raw definition into
  │                   │  an unvalidated NodeGraph
  └────────┬──────────┘
           │
           ▼
  ┌───────────────────┐
  │  Static Analyser  │  Validates node schemas,
  │                   │  checks for unknown refs,
  │                   │  enforces naming rules
  └────────┬──────────┘
           │
           ▼
  ┌───────────────────┐
  │  Cycle Detector   │  Kahn's algorithm (BFS).
  │                   │  Fails closed on any cycle.
  │                   │  Returns full cycle path
  │                   │  in error payload.
  └────────┬──────────┘
           │
           ▼
  ┌───────────────────┐
  │ Topological Sort  │  Emits a deterministic
  │                   │  execution order. Stable
  │                   │  sort — same input always
  │                   │  produces same order.
  └────────┬──────────┘
           │
           ▼
  ┌───────────────────┐
  │  Graph Optimiser  │  Merges trivially serial
  │  (stretch, M1.1)  │  chains. Annotates parallel
  │                   │  execution boundaries.
  └────────┬──────────┘
           │
           ▼
  ResolvedExecutionGraph  ←  consumed by Dependency
                              Resolver (M1.2) and
                              Execution Engine (M1.3)
```

### 3.2 Interface / API Contract

The following types form the frozen SDK surface after
M1.1 ships. Changes require a new RFC.

```typescript
// --- Workflow Definition (author-facing input) ---

export interface WorkflowDefinition {
  id: string;                        // unique workflow identifier
  version: string;                   // semver
  nodes: Record<string, NodeDefinition>;
  entrypoints: string[];             // node IDs with no dependencies
}

export interface NodeDefinition {
  id: string;
  type: string;                      // registered node type
  dependsOn: string[];               // node IDs this node waits for
  config: Record<string, unknown>;   // node-type-specific config
  timeout?: number;                  // ms; inherits workflow default if absent
  retryPolicy?: RetryPolicy;
}

export interface RetryPolicy {
  maxAttempts: number;               // 1 = no retry
  backoffMs: number;                 // initial back-off delay
  backoffMultiplier: number;         // exponential factor
}

// --- Compiler Output (runtime-facing output) ---

export interface ResolvedExecutionGraph {
  workflowId: string;
  compiledAt: string;                // ISO 8601
  compilerVersion: string;
  executionOrder: string[][];        // parallel batches in topo order
                                     // [[A], [B,C], [D]] means:
                                     // run A, then B+C in parallel, then D
  nodes: Record<string, ResolvedNode>;
  metadata: GraphMetadata;
}

export interface ResolvedNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  dependsOn: string[];
  dependents: string[];              // derived — not in raw definition
  timeout: number;
  retryPolicy: RetryPolicy;
  batchIndex: number;               // which parallel batch this node sits in
}

export interface GraphMetadata {
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;                 // longest dependency chain
  parallelBatches: number;          // number of execution batches
  estimatedCriticalPathMs?: number; // optional; requires node timing hints
}

// --- Compiler Errors ---

export type CompilerError =
  | { code: 'CYCLE_DETECTED';     cycle: string[]; message: string }
  | { code: 'UNKNOWN_DEPENDENCY'; nodeId: string;  ref: string     }
  | { code: 'INVALID_NODE_TYPE';  nodeId: string;  type: string    }
  | { code: 'MISSING_ENTRYPOINT'; message: string                  }
  | { code: 'DUPLICATE_NODE_ID';  nodeId: string                   }
  | { code: 'SCHEMA_VIOLATION';   nodeId: string;  field: string   }
  | { code: 'GRAPH_TOO_LARGE';    nodeCount: number; max: number   };

// --- Compiler API ---

import type { NodeTypeRegistry } from './pluginApi';

export type CompileResult =
  | { ok: true;  graph: ResolvedExecutionGraph }
  | { ok: false; errors: CompilerError[] };

/**
 * Core compile. Input is a parsed WorkflowDefinition.
 * JSON/YAML is handled by parse() below — not by compile().
 * `registry` is RFC-0006; required (fail-closed if omitted
 * at the implementation boundary).
 */
export function compile(
  definition: WorkflowDefinition,
  registry: NodeTypeRegistry,
): CompileResult;

/**
 * Thin wrapper only. Does not compile.
 * On failure returns typed errors; never throws.
 */
export function parse(
  source: string,
  format: 'json' | 'yaml',
): { ok: true; definition: WorkflowDefinition } | { ok: false; errors: CompilerError[] };
```

### 3.3 Data Flow

1. Caller invokes `compile(definition, registry)` (RFC-0006
   registry). Optional: `parse(source, format)` first.
2. **Parser** deserialises the definition and constructs
   an adjacency list of `NodeDefinition` objects
3. **Static Analyser** iterates all nodes:
   - Validates each `type` against the registered node
     type registry
   - Checks all `dependsOn` references resolve to real
     node IDs in the same definition
   - Detects duplicate node IDs
   - Validates required config fields per node type schema
     (RFC-0006 `getNodeType`)
   - If `nodeCount > 10_000`: `GRAPH_TOO_LARGE` and stop
4. **Cycle Detector** runs Kahn's algorithm (BFS) on the
   adjacency list:
   - Computes in-degree for each node
   - Enqueues all zero-in-degree nodes
   - Iteratively removes nodes; decrements in-degree of
     their dependents; enqueues newly zero-in-degree nodes
   - If any nodes remain after the BFS, a cycle exists —
     returns `CYCLE_DETECTED` with the cycle path
5. **Topological Sort** emits `executionOrder` — an array
   of batches where all nodes in a batch may execute in
   parallel. Nodes within a batch have no dependency on
   each other.
6. **Graph Optimiser** (stretch goal within M1.1) merges
   single-node batches that could be collapsed, annotates
   the critical path, and computes `GraphMetadata`
7. Returns `CompileResult` — either `ok: true` with the
   `ResolvedExecutionGraph` or `ok: false` with a typed
   error array. Never throws.

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Cycle detected | Return `ok: false`, `CYCLE_DETECTED` with full cycle path array | Author fixes definition; re-compile |
| Unknown dependency ref | Return `ok: false`, `UNKNOWN_DEPENDENCY` per offending node | Author fixes `dependsOn`; re-compile |
| Invalid node type | Return `ok: false`, `INVALID_NODE_TYPE` | Author registers type or corrects spelling |
| Schema violation | Return `ok: false`, `SCHEMA_VIOLATION` with field name | Author corrects config |
| Missing entrypoint | Return `ok: false`, `MISSING_ENTRYPOINT` | Author adds a node with empty `dependsOn` |
| Graph exceeds 10,000 nodes | Return `ok: false`, `GRAPH_TOO_LARGE` | Split the workflow |
| Unexpected internal error | Log + return `ok: false` with internal error code; never surface stack trace to caller | File bug; compiler is safe to retry |

The compiler **never throws**. All error conditions are
returned as typed values. Callers must check `ok` before
using `graph`.

### 3.5 Idempotency Guarantees

- `compile()` is a pure function. Same input always
  produces the same `CompileResult`.
- The topological sort is **stable** — nodes at the same
  depth are sorted lexicographically by ID, ensuring
  deterministic `executionOrder` output across runs.
- No state is written or mutated by the compiler. It is
  safe to call concurrently from multiple goroutines /
  threads without locking.

---

## § 4 — Alternatives Considered

### Option A — Runtime-only resolution (Rejected)

**Summary:** Skip the compile step entirely; resolve
dependencies lazily at execution time as nodes complete.

**Reason rejected:** Cycles would only be detected mid-run,
after work has already begun. Error messages would be
cryptic. No static tooling (visualiser, IDE hints) would
be possible. Violates the fail-closed principle —
ambiguity should halt at compile time, not at execution.

### Option B — DAG Compiler as external CLI tool (Rejected)

**Summary:** Implement the compiler as a standalone binary
invoked before `smartware run`, not as an in-process
library.

**Reason rejected:** Adds a mandatory build step that breaks
the existing `smartware run <definition>` UX from v1.0.0
GA. Embedding the compiler as a library keeps the UX
intact while still allowing an optional `smartware compile`
CLI command as a thin wrapper. The library-first approach
also makes the compiler testable without process spawning.

### Option C — Use an existing DAG library (Rejected)

**Summary:** Adopt an off-the-shelf DAG library rather than
implementing from scratch.

**Reason rejected:** Available libraries either lack the
typed error contract required by the Dependency Resolver
(M1.2), impose unacceptable transitive dependencies, or
are not maintained. The compiler is small enough (~600 LOC
estimated) that owning it is lower risk than a dependency.
Ownerware tiebreaker applied: prefer code we own and can
audit over a third-party black box.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| v1.0.0 Runtime (linear queue) | None | Compiler is additive; queue untouched until M1.3 |
| Plugin API v1 (RFC-0006) | Major | Registry + config schema; compiler does not own types |
| SDK (TypeScript/Go) | Major | `compile()` and all types exported as public API |
| CLI (`smartware run`) | Minor | Runs compiler before execution; surfaces errors inline |
| CI/CD pipeline | Minor | Must add compile-phase tests and fuzz suite |
| DAG Visualizer (M1.4) | Dependency | Visualizer consumes `ResolvedExecutionGraph` directly |
| Dependency Resolver (M1.2) | Dependency | Blocked on `ResolvedExecutionGraph` contract being frozen |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| Node type registry (RFC-0006) | Internal | Static Analyser calls `getNodeType` |
| Plugin API v1 freeze (RFC-0006) | Internal | Hard dependency; accepted with this RFC |
| SDK DSL definition | Internal | Authors write `WorkflowDefinition`; `parse()` is optional |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — compiler is a pure
      in-process function; touches no network
- [x] **Telemetry is opt-in** — compiler emits no telemetry
      by default; compile metrics available via local
      instrumentation hook only
- [x] **Feature flags** — no billing or metering code
- [x] **Fail-closed** — all error paths return typed errors;
      compiler never silently succeeds on invalid input
- [x] **Idempotent** — pure function; same input, same output
- [x] **mTLS** — N/A (Phase 1; no inter-node communication)

### 5.4 Performance Targets

| Metric | Baseline | Target | Measurement Method |
|--------|----------|--------|--------------------|
| Compile time P95 | N/A (new) | < 200 ms | Benchmark suite on reference hardware |
| Compile time for 10,000-node graph | N/A | < 500 ms | Stress test in CI |
| Memory allocation per compile | N/A | < 50 MB for 10k nodes | Heap profiler |
| Cycle detection on 10k node graph | N/A | < 100 ms | Isolated benchmark |

### 5.5 Rollback Plan

The compiler is additive in M1.1 — the v1.0.0 linear queue
remains fully operational. If the compiler is found to be
incorrect post-merge:

1. Gate `compile()` invocation behind feature flag
   `SMARTWARE_DAG_COMPILER=0` (defaults to `1` after M1.1)
2. Flag reverts runtime to v1.0.0 linear queue behaviour
3. No data loss risk — compiler does not persist state

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | Should `executionOrder` batches be arrays or sets? | Bell Corporate Labs | Arrays (`string[][]`). Order inside a batch is lexicographic by node ID (§3.5). | ☑ |
| 2 | Does the Node Type Registry live in the compiler package or the plugin API package? | Bell Corporate Labs | Plugin API package (RFC-0006). Compiler imports it. | ☑ |
| 3 | Hard-reject above 10,000 nodes or warn? | Bell Corporate Labs | Hard-reject: `GRAPH_TOO_LARGE`. Fail-closed. | ☑ |
| 4 | Should `compile()` accept a raw string or a parsed `WorkflowDefinition`? | Bell Corporate Labs | Parsed `WorkflowDefinition` plus `registry`. JSON/YAML via `parse()` only. | ☑ |

---

## § 7 — Implementation Plan

> Populated after DRI accepted this RFC (2026-09-09).

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| Consume RFC-0006 `NodeTypeRegistry` (do not reimplement) | Bell Corporate Labs | TBD | M1.1 |
| DAG Parser (`parse` JSON/YAML → `WorkflowDefinition`) | Bell Corporate Labs | TBD | M1.1 |
| Static Analyser | Bell Corporate Labs | TBD | M1.1 |
| Cycle Detector (Kahn's algorithm) | Bell Corporate Labs | TBD | M1.1 |
| Topological Sort (stable) | Bell Corporate Labs | TBD | M1.1 |
| `GRAPH_TOO_LARGE` cap at 10,000 | Bell Corporate Labs | TBD | M1.1 |
| Graph Optimiser (stretch) | Bell Corporate Labs | TBD | M1.1 |
| SDK export (`compile()` + `parse()` + types) | Bell Corporate Labs | TBD | M1.1 |
| CLI integration (`smartware run`) | Bell Corporate Labs | TBD | M1.1 |
| Benchmark suite | Bell Corporate Labs | TBD | M1.1 |
| Fuzz test suite (cycle + schema) | Bell Corporate Labs | TBD | M1.1 |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit | 95% line coverage | Every error code must have a test |
| Integration | All `CompilerError` codes exercised end-to-end | Via CLI |
| Regression (v1.0.0 baseline) | 0 new failures | All existing workloads run through new path |
| Fuzz — cycle detection | 10,000+ randomised graphs | Must catch all cycle shapes |
| Performance benchmark | P95 < 200ms | Runs in CI on every merge to main |

### Definition of Done

- [ ] All tasks above marked complete
- [ ] `CompileResult` contract frozen — no further changes
      without a new RFC
- [ ] Fuzz suite integrated into CI
- [ ] Performance benchmarks passing in CI
- [ ] `RELEASE_NOTES.md` entry drafted for M1.1
- [ ] Open questions in § 6 all marked resolved
- [ ] DRI sign-off recorded in § 8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC draft created. Open questions in §6 require
  DRI resolution before moving to in-review.
  M1.2 (Dependency Resolver) is blocked on this RFC
  reaching `accepted`.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review
  Open questions in §6 resolved. Plugin API is RFC-0006.
  compile() takes WorkflowDefinition + NodeTypeRegistry.
  GRAPH_TOO_LARGE hard-rejects above 10,000 nodes.

2026-09-09 | Bell Corporate Labs | Status: in-review → accepted
  Design approved. Implementation may begin.
  Linked to milestone: M1.1
  Sign-off directed by the DRI in session; agent recorded
  the entry and did not self-approve.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0006 — Plugin API v1 | `docs/rfcs/0006-plugin-api.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Master roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |
| Kahn's algorithm | Kahn, A.B. (1962). Topological sorting of large networks. CACM 5(11) |

---

*Bell Corporate Labs · smartware-core*
*RFC-0001 · DAG Compiler Alpha · M1.1 · Phase 1*