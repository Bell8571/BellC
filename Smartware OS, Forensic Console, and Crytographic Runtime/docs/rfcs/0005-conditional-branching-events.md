---
label: RFC:CONDITIONAL-BRANCHING-EVENTS-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0005"
title: "Implement Conditional Branching and Event-Driven Triggers — Runtime Predicates, Bounded Loops, and Local Resume Hooks"
status: draft
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: ""
phase: 1
milestone: "M1.5"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: "RFC-0003 (docs/rfcs/0003-parallel-execution-engine.md)"
---

# RFC-0005 — Conditional Branching + Event Triggers

> **Status:** `draft`
> **DRI:** _assign before moving to in-review_
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.5 — Conditional Branching + Event Triggers (March 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. BLOCKED: This RFC depends on RFC-0003 reaching `accepted`
   and ExecutionEngine.dispatch remaining frozen. Do not
   implement any scope here until BOTH conditions are met
   and §8 contains a DRI sign-off.

2. Import types from RFC-0001 §3.2, RFC-0002 §3.2, and
   RFC-0003 §3.2. Do not fork ResolvedExecutionGraph,
   ResolverInboundEvent, or dispatch().

3. The Engine still only executes NODE_READY. Predicate
   evaluation belongs in the Resolver (and a compile-time
   check in the Compiler). The Engine must not interpret
   if/else, switch, or loop.

4. Fail-closed: the Compiler still rejects cycles. Bounded
   loops MUST NOT be encoded as unrestricted back-edges.
   Unbounded loops, eval(), and Function() are prohibited.

5. Event triggers bind locally by default. No external
   webhook URL, queue vendor, or telemetry sink is
   contacted unless the customer configures it. Default
   off for any non-loopback listener.

6. M1.5 required scope is branching (if/else, switch,
   bounded loop). Event-driven triggers are in this RFC
   but are the first cut if the milestone slips — see §6
   question 1 and the Phase 1 visualizer-style scope cap.

7. Do not scaffold Phase 2 distributed components. Do not
   treat this RFC as locking Phase 1 GA (that is M1.6).
```

---

## § 1 — Summary

This RFC extends the Phase 1 DAG with **runtime conditional
branching** (`if/else`, `switch`, bounded `loop`) evaluated
against upstream node output payloads, and with **local
event triggers** that can start a workflow or resume a
waiting node without restarting the whole graph.

Compile-time structure (which arms exist, loop bounds) is
part of the graph. Runtime choice of which arm runs is the
Resolver's job. Untaken arms transition to `SKIPPED`. The
Engine remains a thin executor of `NODE_READY`.

This RFC is `draft`. It does not complete or lock Phase 1.
M1.6 (regression suite + phase gate) remains a separate
milestone with a human DRI sign-off.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

RFC-0001 graphs are static DAGs: every node in
`executionOrder` is intended to run, subject only to
RFC-0002 `HALT` / `CONTINUE` failure policy. There is no
`if/else`, `switch`, or `loop`. There is no way to park a
node until a webhook or queue message arrives; the only
entry is `resolver.init()`.

### 2.2 Desired Outcome

- Authors declare `if/else`, `switch`, and bounded `loop`
  in the workflow DSL.
- Predicates run against structured `NODE_SUCCEEDED.output`
  (already on RFC-0002 inbound events).
- Untaken arms are `SKIPPED`; taken arms become `READY`
  through the existing Resolver path.
- Loops cannot create an unrestricted cycle; `maxIterations`
  is mandatory.
- Optional local triggers **initiate** a run or **resume**
  a waiting node.

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.5 |
| Milestone Name | Conditional Branching + Event Triggers |
| Target Date | March 2027 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Blocked By | M1.3 — Parallel Execution Engine (RFC-0003) |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  WorkflowDefinition + ControlFlow (this RFC)
          │
          ▼
  ┌──────────────────────────────────┐
  │  DAG Compiler (RFC-0001 +        │
  │  control-flow pass)              │
  │                                  │
  │  Validates predicates statically │
  │  (syntax + path shape).          │
  │  Embeds all arms in the graph.   │
  │  Rejects cycles. Loops are NOT   │
  │  compiled as free back-edges.    │
  └──────────┬───────────────────────┘
             │  ResolvedExecutionGraph
             │  (nodes carry control annotations)
             ▼
  ┌──────────────────────────────────┐
  │  Dependency Resolver             │
  │  (RFC-0002 + predicate eval)     │
  │                                  │
  │  On NODE_SUCCEEDED:              │
  │    evaluate predicate against    │
  │    output payload.               │
  │    READY taken arm; SKIPPED      │
  │    untaken arm.                  │
  │  Loop: re-READY body until       │
  │    predicate false or max.       │
  └──────────┬───────────────────────┘
             │  NODE_READY only
             ▼
  Execution Engine (RFC-0003) — unchanged dispatch

  Event Trigger Listener (local, optional)
             │  START_WORKFLOW | RESUME_NODE
             ▼
  Resolver.init() or WAITING → READY
```

### 3.2 Interface / API Contract

RFC-0001 `NodeDefinition` grows an optional `control`
field. That is a deliberate DSL extension and is frozen
only when this RFC is `accepted`.

```typescript
import type {
  NodeDefinition,
  ResolvedNode,
  WorkflowDefinition,
} from './dagCompiler';
import type {
  NodeState,
  ResolverInboundEvent,
  ResolverOutboundEvent,
} from './dependencyResolver';

// ── Predicate language (non-Turing-complete) ───────────
// No loops, no I/O, no assignment, no eval/Function.

export type JsonScalar = string | number | boolean | null;

export type Predicate =
  | {
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
      path: string;            // dotted path into the output object
      value?: JsonScalar;      // required except for `exists`
    }
  | { op: 'and' | 'or'; clauses: Predicate[] }
  | { op: 'not'; clause: Predicate };

export type ControlFlow =
  | {
      kind: 'if';
      predicate: Predicate;
      then: string[];          // node IDs in the taken arm
      else: string[];          // node IDs in the untaken arm (may be empty)
    }
  | {
      kind: 'switch';
      path: string;
      cases: { equals: JsonScalar; then: string[] }[];
      default: string[];
    }
  | {
      kind: 'loop';
      predicate: Predicate;
      body: string[];          // node IDs executed each iteration
      maxIterations: number;   // required; >= 1; hard cap
    };

export interface BranchingNodeDefinition extends NodeDefinition {
  control?: ControlFlow;
}

export interface BranchingWorkflowDefinition extends WorkflowDefinition {
  nodes: Record<string, BranchingNodeDefinition>;
  triggers?: TriggerBinding[];
}

// ── Compiler annotations (runtime-facing) ──────────────

export interface ResolvedControlNode extends ResolvedNode {
  control?: ControlFlow;
}

export type BranchingCompilerError =
  | { code: 'INVALID_PREDICATE'; nodeId: string; message: string }
  | { code: 'UNKNOWN_ARM_NODE'; nodeId: string; ref: string }
  | { code: 'UNBOUNDED_LOOP'; nodeId: string }
  | { code: 'LOOP_AS_CYCLE'; nodeId: string; message: string }
  | { code: 'EMPTY_SWITCH'; nodeId: string };

// ── Resolver extension: WAITING ────────────────────────
// Additive state. Existing RFC-0002 transitions unchanged.

export type BranchingNodeState = NodeState | 'WAITING';

// Additional legal transitions:
//   PENDING  → WAITING   (node is trigger-gated)
//   WAITING  → READY     (trigger accepted)
//   WAITING  → SKIPPED   (HALT / cancel)
//   WAITING  → CANCELLED

// ── Predicate evaluation ───────────────────────────────

export type PredicatesResult =
  | { ok: true; value: boolean }
  | { ok: false; code: 'PREDICATE_AMBIGUOUS'; reason: string };

/**
 * Pure function. Same predicate + payload → same result.
 * Missing paths: `exists` → false; comparison ops →
 * PREDICATE_AMBIGUOUS (fail-closed, do not coerce).
 */
export function evaluatePredicate(
  predicate: Predicate,
  payload: Record<string, unknown> | undefined,
): PredicatesResult;

// ── Event triggers (local) ─────────────────────────────

export type TriggerBinding =
  | {
      id: string;
      kind: 'webhook';
      path: string;            // served on loopback only by default
      action: TriggerAction;
      enabled?: boolean;       // default false
    }
  | {
      id: string;
      kind: 'queue';
      channel: string;         // in-process channel name
      action: TriggerAction;
      enabled?: boolean;       // default false
    };

export type TriggerAction =
  | { type: 'START_WORKFLOW'; workflowId: string }
  | { type: 'RESUME_NODE'; workflowId: string; nodeId: string };

export interface TriggerDelivery {
  triggerId: string;
  idempotencyKey: string;
  receivedAt: string;
  payload?: Record<string, unknown>;
}

export interface TriggerListener {
  /**
   * Bind local listeners. Webhook bind address defaults to
   * 127.0.0.1. Non-loopback bind requires explicit config
   * and remains disabled when unset.
   */
  start(bindings: TriggerBinding[]): void;
  stop(): void;
  handle(delivery: TriggerDelivery): ResolverOutboundEvent[];
}
```

`evaluatePredicate` is the only evaluator. JavaScript
`eval` / `Function` and OS shell interpolation are
prohibited in this component.

### 3.3 Data Flow

**Branching**

1. Author includes `control` on one or more nodes.
2. Compiler static pass:
   - Parses predicates; rejects unknown ops and empty
     `switch`.
   - Resolves `then` / `else` / `cases` / `body` IDs.
   - Requires `loop.maxIterations >= 1`.
   - Runs Kahn cycle detection on the **static** edge set.
     Loop body edges go from the loop node to body entry
     nodes only; there is **no** compiled back-edge.
   - All arms remain in `ResolvedExecutionGraph` so the
     Visualizer (RFC-0004) can draw skipped arms.
3. Resolver `init()` as in RFC-0002.
4. On `NODE_SUCCEEDED` of a node with `control`:
   - Read `output` from the inbound event.
   - `evaluatePredicate` (or switch match).
   - If `ok: false` → emit `RESOLVER_STATE_AMBIGUOUS`;
     do not READY either arm.
   - If true: READY the taken arm's nodes whose other
     `dependsOn` are satisfied; SKIPPED the untaken arm
     (recursively, same as HALT isolation).
5. Loop node:
   - Iteration 1: if predicate true, READY `body`.
   - When all body nodes are terminal, increment
     iteration; if predicate still true and
     `iteration < maxIterations`, READY `body` again
     with a **new** `idempotencyKey`.
   - If predicate false, loop node → `SUCCEEDED`.
   - If `maxIterations` hit with predicate still true →
     loop node → `FAILED` with `LOOP_LIMIT_EXCEEDED`.

**Event triggers**

1. `TriggerListener.start` only arms bindings with
   `enabled: true`.
2. Webhook default bind: `127.0.0.1`. Queue default:
   in-process channel. No cloud broker in Phase 1.
3. `START_WORKFLOW`: `resolver.init(graph, config)` for
   a new run id. Duplicate `idempotencyKey` is a no-op.
4. `RESUME_NODE`: target node must be `WAITING`.
   Transition `WAITING` → `READY` and emit `NODE_READY`.
   Wrong state → `RESOLVER_STATE_AMBIGUOUS`; do not start
   a second run of the whole graph.

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Invalid predicate syntax | Compile `INVALID_PREDICATE`; no graph | Author fixes DSL |
| Loop missing `maxIterations` or `< 1` | Compile `UNBOUNDED_LOOP` | Set a bound |
| Loop encoded as a free cycle | Compile `LOOP_AS_CYCLE` | Use `kind: 'loop'` |
| Predicate path missing at runtime | `PREDICATE_AMBIGUOUS`; halt that branch | Make output explicit or use `exists` |
| Switch no match and empty `default` | Compile-time `EMPTY_SWITCH` or runtime SKIPPED of all cases + ambiguous if default missing | Require `default` in compiler |
| Trigger for non-WAITING node | `RESOLVER_STATE_AMBIGUOUS`; no graph restart | Wait until the node is WAITING |
| Duplicate trigger `idempotencyKey` | No-op | Safe by design |
| Webhook requested on non-loopback without opt-in | Listener refuses to start | Bind loopback or set explicit opt-in config |
| `eval` / `Function` in a plugin evaluator | Out of contract; must not be used | Use `evaluatePredicate` only |

### 3.5 Idempotency Guarantees

- Predicate evaluation is pure.
- Each loop iteration issues a new `idempotencyKey` for
  body `NODE_READY` events (RFC-0002 rule preserved).
- Trigger deliveries are keyed; retries of the same key
  do not double-init or double-resume.
- SKIPPED arms are not dispatched. Re-applying the same
  `NODE_SUCCEEDED` does not re-evaluate (RFC-0002
  duplicate-success no-op).

---

## § 4 — Alternatives Considered

### Option A — Lazy graph: compile only the taken arm (Rejected)

**Summary:** Compiler emits only the entry node; Resolver
splices nodes in after predicates succeed.

**Reason rejected:** Visualizer and `snapshot()` would see a
mutating topology, contradicting RFC-0004 (no inferred
edges) and RFC-0001 (frozen graph after compile). Fail-closed
prefers a full static graph with `SKIPPED` arms.

### Option B — Unroll loops at compile time (Rejected)

**Summary:** Repeat the body `maxIterations` times as distinct
nodes so the graph stays a trivial DAG.

**Reason rejected:** A 10,000-node cap (Phase 1 metric) is
burned by `maxIterations` × body size. Runtime re-READY of
the same body IDs with a new idempotency key keeps the graph
small and still bounded.

### Option C — Engine evaluates predicates (Rejected)

**Summary:** Put `if/else` in the worker before `execute()`.

**Reason rejected:** RFC-0003 forbids the Engine from owning
dependency evaluation. Splitting branch choice across Engine
and Resolver forks the source of truth for `SKIPPED` vs
`READY`.

### Option D — Remote webhooks and vendor queues in M1.5 (Rejected / deferred)

**Summary:** First-class public HTTP ingress and cloud queues.

**Reason rejected for Phase 1:** Ownerware default is local.
Public ingress and distributed buses are Phase 2/3 territory.
Local loopback webhook + in-process channel are the Phase 1
shape. External adapters need a later RFC after M1.6.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| DAG Compiler (RFC-0001) | Major — DSL extension | Optional `control`; new error codes |
| Dependency Resolver (RFC-0002) | Major | Predicate eval; `WAITING`; loop re-READY |
| Execution Engine (RFC-0003) | None at dispatch | Still only runs `NODE_READY` |
| DAG Visualizer (RFC-0004) | Minor | Must display `SKIPPED` arms and `WAITING`; tolerate unknown `control` |
| SDK | Major | Predicate + trigger types exported |
| CLI | Minor | Trigger listener start/stop; inspect shows skipped arms |
| v1.0.0 linear queue | None | Feature-flag path unchanged |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| RFC-0001 `compile()` | Internal | Control-flow pass |
| RFC-0002 `handle()` / `SKIPPED` | Internal | Arm isolation |
| RFC-0003 `dispatch()` | Internal | Unchanged consumer |
| Loopback HTTP (optional) | Internal | Webhook trigger; default off |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — no remote trigger
      bus; loopback default
- [x] **Telemetry is opt-in** — no external endpoint
- [x] **Feature flags** — no billing or metering;
      triggers default `enabled: false`
- [x] **Fail-closed** — ambiguous predicates halt the
      branch; non-loopback bind refused without opt-in
- [x] **Idempotent** — trigger keys and loop iteration keys
- [x] **mTLS** — N/A (Phase 1; local listener only)

### 5.4 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Predicate eval P95 | < 0.5 ms | Microbenchmark in CI |
| Compile with 1,000 branch nodes | Still < 200 ms P95 (RFC-0001) | Compiler benchmark |
| Loop 100 iterations, 10-node body | No leaked READY / duplicate side effects | Integration + idempotency tests |
| Trigger duplicate delivery | 0 extra inits | Unit test |

### 5.5 Rollback Plan

Branching is additive. Workflows without `control` or
`triggers` behave as RFC-0001–0003.

If this RFC is found incorrect post-merge:
1. Authors omit `control` / `triggers`; compiler path is
   the M1.3 graph
2. `SMARTWARE_DAG_BRANCHING=0` disables the control-flow
   pass and trigger listener (defaults to `1` after M1.5)
3. `SMARTWARE_DAG_COMPILER=0` still reverts to the v1.0.0
   queue (RFC-0001 §5.5)
4. File bug against RFC-0005; fix in patch release

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | If M1.5 slips, is the cut line “branching only” with triggers as a follow-on RFC, or both features stay coupled? Branching-required / triggers-stretch is proposed | Bell Corporate Labs | TBD | ☐ |
| 2 | Output payload typing: `Record<string, unknown>` vs per-node JSON Schema from the plugin registry? Schema would catch missing paths at compile time | Bell Corporate Labs | TBD | ☐ |
| 3 | Does `WAITING` need an RFC-0002 revision before this RFC can be accepted, or is an additive state in 0005 enough? | Bell Corporate Labs | TBD | ☐ |
| 4 | Loop body node IDs reused across iterations: does the Visualizer treat that as one node with `attempts`, or as virtual iteration rows? Attempts overlay proposed | Bell Corporate Labs | TBD | ☐ |
| 5 | Webhook authentication on loopback: none, shared secret header, or always-off until a later security RFC? | Bell Corporate Labs | TBD | ☐ |

---

## § 7 — Implementation Plan

> [HUMAN REQUIRED] — Do not populate until RFC status
> is `accepted` and §8 contains a DRI sign-off.

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| Predicate AST + `evaluatePredicate` | TBD | TBD | M1.5 |
| Compiler control-flow pass + new error codes | TBD | TBD | M1.5 |
| Resolver: if/else + switch SKIPPED arms | TBD | TBD | M1.5 |
| Resolver: bounded loop re-READY | TBD | TBD | M1.5 |
| `WAITING` state + legal transitions | TBD | TBD | M1.5 |
| Trigger listener (loopback webhook) | TBD | TBD | M1.5 stretch-if-slip |
| Trigger listener (in-process queue) | TBD | TBD | M1.5 stretch-if-slip |
| SDK export of Predicate / ControlFlow | TBD | TBD | M1.5 |
| CLI + inspect skipped/waiting overlay | TBD | TBD | M1.5 |
| `SMARTWARE_DAG_BRANCHING` flag | TBD | TBD | M1.5 |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit — predicate | Every op; missing path → ambiguous | No `eval` |
| Unit — if/else | Taken vs untaken SKIPPED | |
| Unit — switch | Match, default, empty-default rejected | |
| Unit — loop | Stop on false; fail on maxIterations | New idempotencyKey per iteration |
| Unit — cycle | Loop kind must not satisfy a Kahn cycle | |
| Integration — Engine | Engine never sees untaken-arm NODE_READY | |
| Idempotency — triggers | Duplicate key is no-op | |
| Regression (v1.0.0 baseline) | 0 new failures | Graphs without `control` |

### Definition of Done

- [ ] `if/else`, `switch`, bounded `loop` passing tests
- [ ] Event triggers implemented **or** explicitly deferred
      per DRI answer to §6 question 1
- [ ] No Phase 2 scaffolding
- [ ] All open questions in §6 resolved
- [ ] `RELEASE_NOTES.md` entry drafted for M1.5
- [ ] DRI sign-off recorded in §8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC draft created.
  BLOCKED on RFC-0003 reaching `accepted`.
  Open questions in §6 require DRI resolution before
  moving to in-review.
  This RFC does not lock Phase 1 GA (M1.6) and does
  not authorise Phase 2 work.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0001 — DAG Compiler | `docs/rfcs/0001-dag-compiler.md` |
| RFC-0002 — Dependency Resolver | `docs/rfcs/0002-dependency-resolver.md` |
| RFC-0003 — Parallel Execution Engine | `docs/rfcs/0003-parallel-execution-engine.md` |
| RFC-0004 — DAG Visualizer | `docs/rfcs/0004-dag-visualizer.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Master roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0005 · Conditional Branching + Event Triggers · M1.5 · Phase 1*
