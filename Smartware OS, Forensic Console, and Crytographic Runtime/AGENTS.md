---
label: AGENT-CONTEXT:ROOT-ENTRY
classification: CRITICAL
security_level: RESTRICTED
version: "1.0.0"
date: 2026-09-09
author: Bell Corporate Labs
loaded_by: all agents, all sessions
authority: docs/AI_INSTRUCTIONS.md
---

# Smartware — Agent Context & Operating Instructions

> This file is the **first thing every agent session loads**.
> It is the root entry point for all AI-assisted work in this
> repository. Read it fully before reading any other file.

---

## § 1 — What This Project Is

**Smartware** is a composable, distributed execution platform
built around a native DAG runtime. The product is delivered
in three post-GA phases, with a long-term evolution toward
Smartware OS — a unified execution substrate across cloud,
edge, and on-prem.

You are working inside the `smartware-core` monorepo.
Your job is to help build, document, and reason about this
system — within the guardrails defined in this file and in
`docs/AI_INSTRUCTIONS.md`.

---

## § 2 — Load Order (MANDATORY)

Load documents in this exact order before acting on any task.
Higher-numbered documents never override lower-numbered ones.

```
1. docs/AI_INSTRUCTIONS.md          ← AUTHORITY-0 · read first, always
2. docs/02_POST_GA_STRATEGIC_ROADMAP.md  ← phase map, dependency graph
3. docs/03_PHASE_1_RUNTIME_DAG.md        ← if working in Phase 1
4. docs/04_PHASE_2_DISTRIBUTED_FABRIC.md ← if working in Phase 2
5. docs/05_PHASE_3_SMARTWARE_CLOUD.md    ← if working in Phase 3
6. docs/06_SMARTWARE_OS_EVOLUTION.md     ← if working on OS tracks
7. docs/RELEASE_NOTES.md                 ← audit log, append-only
```

> **Rule:** If you have not loaded `docs/AI_INSTRUCTIONS.md`
> in this session, stop. Load it now. Then return here.

---

## § 3 — Current Project State

| Item | Value |
|------|-------|
| Current version | v2.1.0-m21 alpha (Phase 2 started; not a verified product GA ship) |
| Active phase | Phase 2 — Distributed Fabric |
| Phase 1 window | Q4 2026 – Q2 2027 (**gate cleared** 2026-09-09 by DRI) |
| Phase 2 window | Q3 2027 – Q2 2028 |
| Next milestone | M2.1 — Cluster Topology Manager v1 |
| Accepted RFCs | RFC-0001…0007 (Phase 1); RFC-0008 Topology (M2.1) |
| Phase gate authority | Human DRI sign-off required |
| Amendment direction | Amendment A (ownerware) — tiebreaker only |
| DRI | Bell Corporate Labs |

---

## § 4 — Agent Roles & Scope

### What you ARE here to do
- Implement milestones in the active phase only
- Write code, tests, documentation, and RFCs that match
  the specifications in the phase files
- Surface ambiguities and blockers clearly before acting
- Follow the fail-closed principle: when in doubt, halt
  and surface the question rather than guessing

### What you are NOT here to do
- Advance work into a future phase before the current
  phase gate is cleared by a human DRI
- Generate code that phones home, meters usage, or holds
  customer keys — unless explicitly scoped as a
  feature-flagged opt-in
- Invent milestones, phase gates, or RFCs without a
  linked human-authored task
- Self-approve or self-merge any AI-generated RFC or
  architectural change

---

## § 5 — Architectural Tiebreaker

> *"When two approaches are equal, pick the one that keeps
> the customer holding their own keys."*

This is the **Ownerware Principle** (Amendment A, directional).
It is not a hard rewrite of any phase — it is a decision
rule applied whenever a design choice is otherwise neutral.

---

## § 6 — Phase Gate Rules (Summary)

| Gate | Condition | Who Clears It |
|------|-----------|---------------|
| Phase 0 → Phase 1 | v1.0.0 GA verified, zero P0 bugs in 30-day burn-in | DRI |
| Phase 1 → Phase 2 | M1.6 GA complete, regression suite passing | DRI |
| Phase 2 → Phase 3 | M2.6 GA complete, consensus store formally reviewed | DRI |
| Phase 3 → OS Alpha | M3.8 GA complete, ≥1 external design partner in production | DRI |

**Agents do not clear phase gates. Agents do not scaffold
the next phase until a gate is cleared.**

---

## § 7 — RFC Protocol

Any major architectural decision requires an RFC before
implementation:

1. Create `docs/rfcs/NNNN-short-title.md`
2. Use the RFC template (see `docs/rfcs/0000-template.md`)
3. Tag the RFC with the relevant milestone ID from the phase file
4. An RFC authored by an AI agent requires human DRI
   review and sign-off before it enters the milestone tracker
5. Implementation work on the RFC scope is blocked until
   sign-off is recorded in the RFC file

---

## § 8 — Prohibited Outputs (Hard Stops)

If a task would require you to produce any of the following,
**stop immediately** and surface the conflict to the developer:

- Hardcoded secrets, tokens, or API keys in any file
- Telemetry pipelines that default to an external endpoint
- Code that advances the project into a phase whose gate
  has not been cleared
- Milestone entries or phase gate changes without a linked
  human-authored task
- Any output that would cause an agent to self-direct
  consequential repository changes (merges, releases,
  infrastructure changes) without human confirmation

---

## § 9 — Quick Reference: Doc Labels

| Label | File | Authority Level |
|-------|------|----------------|
| `CORE-DIRECTIVE:AUTHORITY-0` | `docs/AI_INSTRUCTIONS.md` | 1 — Highest |
| `AGENT-CONTEXT:ROOT-ENTRY` | `AGENTS.md` (this file) | 2 |
| `ROADMAP:STRATEGY-EVOLUTION` | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` | 3 |
| `PHASE:RUNTIME-DAG-v1` | `docs/03_PHASE_1_RUNTIME_DAG.md` | 4 |
| `PHASE:DISTRIBUTED-FABRIC-v1` | `docs/04_PHASE_2_DISTRIBUTED_FABRIC.md` | 4 |
| `PHASE:SMARTWARE-CLOUD-v1` | `docs/05_PHASE_3_SMARTWARE_CLOUD.md` | 4 |
| `OS:STRATEGY-NORTH-STAR` | `docs/06_SMARTWARE_OS_EVOLUTION.md` | 5 |
| `RELEASE:AUDIT-LOG-v1.0.0` | `docs/RELEASE_NOTES.md` | 6 — Reference |
| Index | `docs/FILE_SUMMARY.md` | 6 — Reference |

---

## § 10 — Session Checklist

Before writing any code or document, confirm:

- [ ] `docs/AI_INSTRUCTIONS.md` loaded and read this session
- [ ] Active phase identified from `docs/02_POST_GA_STRATEGIC_ROADMAP.md`
- [ ] Relevant phase file loaded for the task at hand
- [ ] Task maps to a named milestone in the phase file
- [ ] No phase gate is being bypassed
- [ ] No prohibited output is being produced
- [ ] If an RFC is required — RFC file created and linked

---

*Bell Corporate Labs · smartware-core · Internal*
*This file is version-controlled. Do not edit without DRI approval.*

```
smartware-core/
├── AGENTS.md                        ← this file (root, agent entry point)
└── docs/
    ├── AI_INSTRUCTIONS.md           ← AUTHORITY-0
    ├── 02_POST_GA_STRATEGIC_ROADMAP.md
    ├── 03_PHASE_1_RUNTIME_DAG.md
    ├── 04_PHASE_2_DISTRIBUTED_FABRIC.md
    ├── 05_PHASE_3_SMARTWARE_CLOUD.md
    ├── 06_SMARTWARE_OS_EVOLUTION.md
    ├── RELEASE_NOTES.md
    ├── FILE_SUMMARY.md
    └── rfcs/
        ├── 0000-template.md
        ├── 0001-dag-compiler.md
        ├── 0002-dependency-resolver.md
        ├── 0003-parallel-execution-engine.md
        ├── 0004-dag-visualizer.md
        ├── 0005-conditional-branching-events.md
        ├── 0006-plugin-api.md
        ├── 0007-durable-resolver-state.md
        └── 0008-cluster-topology-manager.md
```
