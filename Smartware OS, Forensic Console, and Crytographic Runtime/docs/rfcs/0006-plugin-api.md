---
label: RFC:PLUGIN-API-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0006"
title: "Freeze the Smartware Plugin API v1 — Node Type Registry and Config Schema for the DAG Compiler"
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
---

# RFC-0006 — Plugin API v1 (Registry + Schema)

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

1. Status is ACCEPTED. The registry and config-schema
   contract in §3.2 is frozen. Changes require a new RFC.

2. This RFC is a hard dependency of RFC-0001 (DAG Compiler).
   The compiler Static Analyser MUST look up node types
   here. It must not own or fork the registry.

3. Do NOT define NodeExecutor, worker pools, or dispatch
   in this RFC. Execution of a node is RFC-0003 (M1.3).
   M1.1 only needs type identity + config schema.

4. M1.1 may add optional schema fields. It MUST NOT break
   registered v1 types. Compatibility window: 24 months
   from the v1.0.0 baseline spec (docs/RELEASE_NOTES.md).

5. In-process only. No network. No default telemetry sink.
```

---

## § 1 — Summary

This RFC freezes **Plugin API v1** as the node-type registry
the DAG Compiler (RFC-0001) uses at M1.1: a name, a semver,
and a config schema. It records the v1.0.0 baseline freeze
already listed in `docs/RELEASE_NOTES.md` and the M1.1
extension the Static Analyser needs (`SCHEMA_VIOLATION`).

It does not define how a node runs. `NodeExecutor` remains
RFC-0003. Authors register types here; the compiler validates
`NodeDefinition.type` and `config` against this registry.

---

## § 2 — Motivation & Problem Statement

### 2.1 Current Behaviour

Phase 1 lists “Plugin API contract finalized before M1.1”
as a hard dependency. The baseline spec claims Plugin API v1
is frozen with a 24-month compatibility window. There was no
RFC, so RFC-0001 could not honestly import a registry.

### 2.2 Desired Outcome

- A single in-process registry: `registerNodeType` / `getNodeType`
- Config schema the compiler can check without executing the node
- Additive M1.1 schema export without breaking v1 type names
- Execution plugins stay out of this contract until M1.3

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | 1 — Runtime DAG |
| Milestone ID | M1.1 |
| Milestone Name | DAG Compiler Alpha |
| Target Date | October 2026 |
| Phase File | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Unblocks | RFC-0001 — DAG Compiler |

---

## § 3 — Detailed Design

### 3.1 Architecture Overview

```
  Plugin author
       │  registerNodeType(...)
       ▼
  ┌──────────────────────────────────┐
  │     Node Type Registry           │
  │     (this RFC)                   │
  │                                  │
  │  type → { version, configSchema }│
  └──────────┬───────────────────────┘
             │  getNodeType(type)
             ▼
  DAG Compiler Static Analyser
  (RFC-0001) — INVALID_NODE_TYPE /
               SCHEMA_VIOLATION

  NodeExecutor (RFC-0003, M1.3)
  is a later consumer of the same
  type string. Not specified here.
```

### 3.2 Interface / API Contract

```typescript
/**
 * JSON-Schema-inspired, intentionally small.
 * Additional keywords may be added in M1.1+ without
 * removing these. Unknown keywords on read: ignore
 * (forward compatible). Missing required: SCHEMA_VIOLATION.
 */
export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'object';

export interface ConfigFieldSchema {
  type: ConfigFieldType;
  required: boolean;
}

export interface NodeConfigSchema {
  fields: Record<string, ConfigFieldSchema>;
}

export interface NodeTypeRegistration {
  type: string;                 // stable id, e.g. "http.request"
  version: string;              // semver of this type implementation
  configSchema: NodeConfigSchema;
}

export interface NodeTypeRegistry {
  /**
   * Register a node type. Duplicate `type` with a different
   * breaking schema is rejected. Duplicate identical
   * registration is a no-op (idempotent).
   */
  registerNodeType(registration: NodeTypeRegistration): RegisterResult;

  /** Lookup. Missing type → undefined (compiler emits INVALID_NODE_TYPE). */
  getNodeType(type: string): NodeTypeRegistration | undefined;

  /** Snapshot for tests and `smartware inspect` of the registry. */
  listNodeTypes(): NodeTypeRegistration[];
}

export type RegisterResult =
  | { ok: true }
  | { ok: false; code: 'DUPLICATE_TYPE'; type: string; message: string }
  | { ok: false; code: 'INVALID_REGISTRATION'; message: string };

export function createNodeTypeRegistry(): NodeTypeRegistry;
```

Built-in types shipping with the runtime register at process
start through the same API. There is no side channel.

### 3.3 Data Flow

1. Runtime (or test harness) calls `createNodeTypeRegistry()`.
2. Built-ins and plugins call `registerNodeType`.
3. `compile(definition)` (RFC-0001) for each node:
   - `getNodeType(node.type)` — missing → `INVALID_NODE_TYPE`
   - For each `configSchema.fields` with `required: true`,
     missing key → `SCHEMA_VIOLATION` with `field`
   - Present values whose JSON type does not match `type`
     → `SCHEMA_VIOLATION`
4. Extra config keys not in the schema: allowed (forward
   compatible). The compiler does not strip them.

### 3.4 Error Handling & Fail-Closed Behaviour

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| Unknown `node.type` | Compiler `INVALID_NODE_TYPE` | Register the type or fix the id |
| Missing required config field | Compiler `SCHEMA_VIOLATION` | Supply the field |
| Wrong JSON type for a field | Compiler `SCHEMA_VIOLATION` | Fix the value |
| `registerNodeType` with empty `type` | `INVALID_REGISTRATION` | Use a non-empty type id |
| Second register of same `type` with a breaking schema | `DUPLICATE_TYPE` | New type id or a later RFC |
| Compiler called with no registry | Fail-closed: treat every type as unknown | Pass a registry into `compile` (see RFC-0001) |

### 3.5 Idempotency Guarantees

- `registerNodeType` of an identical payload is a no-op.
- `getNodeType` / `listNodeTypes` do not mutate.
- Registry state is process-local. No persistence in M1.1.

### 3.6 Compatibility

- Type ids registered at v1.0.0 baseline remain valid for
  24 months from that baseline date.
- M1.1 may add fields to `ConfigFieldSchema` and
  `NodeTypeRegistration`. It may not rename or remove `type`,
  `version`, `configSchema`, or existing `ConfigFieldType`
  literals.
- Execution hooks (`NodeExecutor`) are **out of this freeze**.
  Adding them is RFC-0003, not a silent v1 break.

---

## § 4 — Alternatives Considered

### Option A — Compiler owns the registry (Rejected)

**Summary:** Put `registerNodeType` in the compiler package.

**Reason rejected:** Phase 1 and the baseline spec treat Plugin
API as its own contract. RFC-0001 §6 Q2 is answered here: the
registry lives in the plugin package; the compiler imports it.

### Option B — Include NodeExecutor in v1 freeze (Rejected)

**Summary:** Freeze execute() alongside schema at M1.1.

**Reason rejected:** No parallel engine until M1.3. Freezing
execution now would couple M1.1 to RFC-0003’s worker model.

### Option C — Full JSON Schema draft (Rejected)

**Summary:** Depend on a full JSON Schema library.

**Reason rejected:** Ownerware / audit: keep a small owned
schema. Extra keywords can be added later without a third-party
validator as a hard dependency at M1.1.

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| DAG Compiler (RFC-0001) | Major | Static Analyser calls `getNodeType` |
| Plugin authors | Major | This is the v1 register surface |
| Execution Engine (RFC-0003) | None at M1.1 | Uses the same `type` string later |
| v1.0.0 linear queue | None | Additive registry |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| None external | — | stdlib / in-process map |
| RFC-0001 | Internal | Consumer of `getNodeType` |

### 5.3 Security & Ownerware Checklist

- [x] **Keys stay with the customer** — in-process map
- [x] **Telemetry is opt-in** — registry emits none
- [x] **Feature flags** — no billing
- [x] **Fail-closed** — unknown types do not compile
- [x] **Idempotent** — duplicate identical register is a no-op
- [x] **mTLS** — N/A (Phase 1)

### 5.4 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| `getNodeType` | < 0.01 ms | Microbenchmark |
| `registerNodeType` | < 0.1 ms | Microbenchmark |
| List 1,000 types | < 1 ms | Stress test |

### 5.5 Rollback Plan

1. Stop registering new types; compiler still works for
   built-ins loaded at start
2. `SMARTWARE_DAG_COMPILER=0` reverts runs to the linear
   queue (RFC-0001 §5.5) and never calls this registry
3. File bugs against RFC-0006

---

## § 6 — Open Questions

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | Where does the registry live? | Bell Corporate Labs | Plugin API package. Compiler imports it. | ☑ |
| 2 | Full JSON Schema vs small field map? | Bell Corporate Labs | Small owned `NodeConfigSchema` at M1.1. | ☑ |
| 3 | Does M1.1 freeze NodeExecutor? | Bell Corporate Labs | No. RFC-0003. | ☑ |

---

## § 7 — Implementation Plan

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| `NodeTypeRegistry` in-process map | Bell Corporate Labs | TBD | M1.1 |
| Built-in type registration at startup | Bell Corporate Labs | TBD | M1.1 |
| Wire `getNodeType` into RFC-0001 analyser | Bell Corporate Labs | TBD | M1.1 |
| SDK export of register/get/list | Bell Corporate Labs | TBD | M1.1 |
| Duplicate-register tests | Bell Corporate Labs | TBD | M1.1 |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit — register/get/list | Happy path + duplicate + empty type | |
| Unit — compiler integration | INVALID_NODE_TYPE + SCHEMA_VIOLATION | Via RFC-0001 |
| Regression | 0 new failures on baseline linear-queue path | |

### Definition of Done

- [ ] Registry API frozen as §3.2
- [ ] RFC-0001 analyser uses `getNodeType` only
- [ ] `docs/RELEASE_NOTES.md` M1.1 entry can cite this RFC
- [ ] DRI sign-off in §8 (recorded)

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**

```
2026-09-09 | Bell Corporate Labs (agent-assisted) | Status: draft
  Initial RFC recorded as the missing Plugin API contract
  for M1.1.

2026-09-09 | Bell Corporate Labs | Status: draft → in-review
  Open questions in §6 resolved. Registry lives in the
  plugin package; NodeExecutor deferred to RFC-0003.

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
| RFC-0001 — DAG Compiler | `docs/rfcs/0001-dag-compiler.md` |
| RFC-0003 — Execution Engine | `docs/rfcs/0003-parallel-execution-engine.md` |
| Phase 1 spec | `docs/03_PHASE_1_RUNTIME_DAG.md` |
| Baseline spec | `docs/RELEASE_NOTES.md` |
| Agent entry point | `AGENTS.md` |
| RFC template | `docs/rfcs/0000-template.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC-0006 · Plugin API v1 · M1.1 · Phase 1*
