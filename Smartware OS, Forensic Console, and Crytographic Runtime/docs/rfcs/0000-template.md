---
label: RFC:TEMPLATE
classification: PROCESS
security_level: INTERNAL
rfc_number: "0000"
title: "RFC Title — Short, Imperative, Specific"
status: draft
# status options: draft | in-review | accepted | rejected | superseded | withdrawn
created: YYYY-MM-DD
updated: YYYY-MM-DD
author: ""
dri: ""
# dri = the human who owns this decision and must sign off before implementation
phase: 1
# phase options: 1 | 2 | 3 | OS
milestone: "M0.0"
# must match a milestone ID from the relevant phase file
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
---

# RFC-0000 — RFC Title

> **Status:** `draft`
> **DRI:** _name_
> **Phase:** _1 / 2 / 3 / OS_
> **Milestone:** _M0.0 — Milestone Name_
> **Created:** YYYY-MM-DD
> **Last Updated:** YYYY-MM-DD

---

## Agent Instructions

```
RFC HANDLING RULES — read before acting on this document.

1. This RFC is DRAFT until the Status field reads `accepted`.
   Do not implement any scope described here until that point.

2. An AI agent may author the initial draft sections below.
   Sections marked [HUMAN REQUIRED] must be completed or
   explicitly approved by the named DRI before sign-off.

3. Do not modify §8 (Sign-Off Record) — it is append-only
   and written only by the DRI or a human reviewer.

4. If this RFC conflicts with docs/AI_INSTRUCTIONS.md,
   docs/AI_INSTRUCTIONS.md wins. Surface the conflict in §6.

5. Do not scaffold implementation code until §8 contains
   a sign-off entry with status: accepted.
```

---

## § 1 — Summary

> One paragraph. What is this RFC proposing and why does it
> need a formal decision record? Write this as if the reader
> has not read the phase files.

_Replace this line with your summary._

---

## § 2 — Motivation & Problem Statement

> What problem does this solve? What breaks or degrades without
> this change? Cite the milestone and phase file that surfaces
> the need.

### 2.1 Current Behaviour

_Describe what exists today or what is absent._

### 2.2 Desired Outcome

_Describe the end state this RFC achieves._

### 2.3 Linked Milestone

| Field | Value |
|-------|-------|
| Phase | |
| Milestone ID | |
| Milestone Name | |
| Target Date | |
| Phase File | `docs/0X_PHASE_N_*.md` |

---

## § 3 — Detailed Design

> The core technical section. Be precise. AI agents may draft
> this section; DRI must review before sign-off.

### 3.1 Architecture Overview

_Describe the proposed design. Use diagrams (ASCII or Mermaid)
where they add clarity._

```
Example ASCII diagram placeholder:

  ┌──────────────┐       ┌──────────────┐
  │  Component A │──────▶│  Component B │
  └──────────────┘       └──────────────┘
```

### 3.2 Interface / API Contract

_Define any new interfaces, types, CLI commands, config keys,
or wire protocol changes introduced by this RFC._

```typescript
// Example: TypeScript interface stub
export interface ExampleInterface {
  // define fields here
}
```

### 3.3 Data Flow

_Step-by-step description of how data moves through the new
or modified system. Number each step._

1. _Step one_
2. _Step two_
3. _Step three_

### 3.4 Error Handling & Fail-Closed Behaviour

_How does this component behave on failure? Default must be
fail-closed per docs/AI_INSTRUCTIONS.md § 2._

| Failure Mode | Behaviour | Recovery Path |
|--------------|-----------|---------------|
| | | |
| | | |

### 3.5 Idempotency Guarantees

_Describe how the proposed change ensures idempotent behaviour
for all state-mutating operations (required per AUTHORITY-0)._

---

## § 4 — Alternatives Considered

> [HUMAN REQUIRED] — List at least two alternative approaches
> and explain why they were not chosen. Apply the Ownerware
> Tiebreaker (AGENTS.md § 5) when approaches are otherwise equal.

### Option A — _Name_ (Proposed)

**Summary:** _Why this is the chosen approach._
**Trade-offs:** _What it costs._

### Option B — _Name_ (Rejected)

**Summary:** _What this approach would have done._
**Reason rejected:** _Why it was ruled out._

### Option C — _Name_ (Rejected / Stretch)

**Summary:** _Description._
**Reason rejected:** _Why it was ruled out or deferred._

---

## § 5 — Impact Assessment

### 5.1 Affected Components

| Component | Impact | Notes |
|-----------|--------|-------|
| | None / Minor / Major | |
| | | |

### 5.2 Dependencies Introduced

| Dependency | Type | Justification |
|------------|------|--------------|
| | Internal / External / Phase-gated | |

### 5.3 Security & Ownerware Checklist

> Mark each item. Any `NO` or `N/A` must include a note.

- [ ] **Keys stay with the customer** — no secrets leave the
      cluster boundary by default
- [ ] **Telemetry is opt-in** — no external endpoint is
      contacted without explicit customer configuration
- [ ] **Feature flags** — any billing or metering code is
      isolated behind a flag that defaults to OFF
- [ ] **mTLS enforced** — all new inter-node communication
      uses mTLS by default (Phase 2+ only)
- [ ] **Fail-closed** — ambiguous states halt, not degrade
- [ ] **Idempotent** — all state-mutating operations are safe
      to retry

### 5.4 Performance Targets

| Metric | Baseline | Target | Measurement Method |
|--------|----------|--------|--------------------|
| | | | |

### 5.5 Rollback Plan

_How is this change reversed if the implementation fails
post-merge? Be specific._

---

## § 6 — Open Questions

> Items that must be resolved before this RFC can move to
> `in-review`. AI agents surface questions here; humans answer.

| # | Question | Raised By | Answer | Resolved |
|---|----------|-----------|--------|---------|
| 1 | | | | ☐ |
| 2 | | | | ☐ |
| 3 | | | | ☐ |

---

## § 7 — Implementation Plan

> [HUMAN REQUIRED] — Do not populate until RFC status is
> `accepted`. AI agents must not begin implementation before
> this section is filled and § 8 contains a sign-off.

### Milestones & Tasks

| Task | Owner | Estimate | Milestone |
|------|-------|----------|-----------|
| | | | |

### Testing Requirements

| Test Type | Coverage Target | Notes |
|-----------|----------------|-------|
| Unit | | |
| Integration | | |
| Regression (v1.0.0 baseline) | 0 new failures | Required for all phases |
| Chaos / Fault injection | | Phase 2+ only |

### Definition of Done

- [ ] All tasks above marked complete
- [ ] Test coverage targets met
- [ ] Regression suite passing
- [ ] RELEASE_NOTES.md entry drafted
- [ ] DRI sign-off recorded in § 8

---

## § 8 — Sign-Off Record

> **APPEND-ONLY. Do not edit past entries.**
> AI agents must not write to this section.
> DRI writes here when moving RFC between statuses.

```
YYYY-MM-DD | [author/agent] | Status: draft → draft
  Initial draft created.

YYYY-MM-DD | [DRI name]     | Status: draft → in-review
  Open questions resolved. Alternatives section approved.
  Proceeding to review.

YYYY-MM-DD | [DRI name]     | Status: in-review → accepted
  Design approved. Implementation may begin.
  Linked to milestone: MX.Y
```

---

## § 9 — References

| Reference | Link / Location |
|-----------|----------------|
| Authority-0 | `docs/AI_INSTRUCTIONS.md` |
| Phase roadmap | `docs/02_POST_GA_STRATEGIC_ROADMAP.md` |
| Phase file | `docs/0X_PHASE_N_*.md` |
| Related RFC | `docs/rfcs/NNNN-*.md` |

---

*Bell Corporate Labs · smartware-core*
*RFC template v1.0.0 — copy, rename, and fill in. Do not edit this file.*

## How to use this template

Copy this file, rename it (`NNNN-short-title.md`), and fill in the sections.
Do not edit this file.

```
docs/
└── rfcs/
    ├── 0000-template.md                 ← this file, never edited
    ├── 0001-dag-compiler.md             ← copy of template, filled in
    ├── 0002-dependency-resolver.md
    └── ...
```

Lifecycle: `draft → in-review → accepted → implementation begins → done logged in RELEASE_NOTES.md`.