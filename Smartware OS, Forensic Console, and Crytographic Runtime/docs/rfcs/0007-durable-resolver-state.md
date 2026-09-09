---
label: RFC:DURABLE-RESOLVER-STATE-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0007"
title: "Persist Dependency Resolver Snapshots Locally for Crash Recovery"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 1
milestone: "M1.6"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0007 — Durable Resolver State

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 1 — Runtime DAG
> **Milestone:** M1.6 — Phase 1 GA + Regression Suite (April 2027)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. This RFC is ACCEPTED. Implementation lives in
   src/durableStore.ts and is opt-in via RunOptions.

2. Persistence is local JSON only. No network, no
   cloud store, no telemetry of resolver state.

3. M1.2 Resolver remains the source of truth for
   transitions; this RFC only wraps snapshot I/O.

4. Do not scaffold Phase 2 distributed durability
   under this RFC number.
```

---

## § 1 — Summary

Phase 1 Resolver state is in-memory (RFC-0002). M1.6 requires an accepted durability RFC so crashes can restore node records from a local file without inventing distributed consensus. This RFC defines a JSON snapshot format, save/load APIs, and an opt-in wrapper that persists after each Resolver mutation.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

RFC-0002 keeps `ResolverNodeRecord` maps in process memory. A process crash loses running workflows.

### 2.2 Desired Outcome

Operators may enable a local path. After each `init` / `handle` / `cancel` / `resumeNode`, the full snapshot is written. On restart, `hydrate` restores records for the same `workflowId` / `runId`.

### 2.3 Non-Goals

- Distributed replication or Raft
- Encrypted-at-rest by default (customer may wrap the path)
- Automatic resume of in-flight executor work (engine re-dispatch is a follow-on)

---

## § 3 — Proposed Design

### 3.1 Snapshot Schema

```typescript
interface DurableResolverState {
  workflowId: string;
  runId: string;
  savedAt: string; // ISO-8601
  graph: ResolvedExecutionGraph;
  config: ResolverConfig;
  nodes: Record<string, ResolverNodeRecord>;
}
```

### 3.2 APIs

| Function | Behaviour |
|----------|-----------|
| `saveDurableState(path, state)` | Create parent dirs; write one JSON line/file |
| `loadDurableState(path)` | Parse JSON; throw only on I/O failure (caller fail-closed) |
| `persistAfter(resolver, path, graph, config, runId)` | Snapshot + save |
| `wrapDurable(resolver, …)` | Decorator that persists after mutating methods |

### 3.3 Opt-In

Durability is off unless `RunOptions.durablePath` (or equivalent) is set. Default remains in-memory, matching Ownerware / no-phone-home defaults.

### 3.4 Restore

```typescript
const state = loadDurableState(path);
resolver.hydrate(state.nodes);
// Caller re-wires engine/visualizer; does not invent READY events
```

---

## § 4 — Alternatives Considered

| Option | Decision |
|--------|----------|
| SQLite | Rejected for M1.6 — extra dependency; JSON is reviewable |
| Always-on durability | Rejected — must stay opt-in |
| Phase 2 consensus store | Out of scope; blocked by Phase 1 → 2 gate |

---

## § 5 — Compatibility & Security

- No secrets written beyond whatever the operator put in node outputs
- Path is customer-controlled; no default remote endpoint
- Feature flag / env kill-switch not required beyond omitting the path

---

## § 6 — Open Questions

None for M1.6 alpha. Automatic engine re-dispatch after hydrate is deferred.

---

## § 7 — Implementation Plan

- [x] `src/durableStore.ts`
- [x] Wired from `src/runtime.ts` when durable path set
- [x] Regression test: persist + reload snapshot
- [x] `RELEASE_NOTES.md` entry for M1.6

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> **AI agents must not write to this section.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC authored to satisfy M1.6 durable-state
  gate. Scope limited to local JSON snapshots.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review
  Matches implemented durableStore.ts; opt-in confirmed.

2026-09-09 | Bell Corporate Labs | Status: in-review → accepted
  Design approved. Linked to milestone: M1.6.
  Sign-off directed by the DRI in session; agent recorded
  the entry and did not self-approve.
  Does NOT clear the Phase 1 → Phase 2 gate by itself;
  human DRI still owns phase-gate review.
```

---

## § 9 — References

| Reference | Location |
|-----------|----------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| RFC-0002 — Dependency Resolver | `docs/rfcs/0002-dependency-resolver.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Implementation | `src/durableStore.ts` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0007 · Durable Resolver State · M1.6 · Phase 1*
