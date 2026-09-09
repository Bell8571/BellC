---
label: CORE-DIRECTIVE:AUTHORITY-0
classification: CRITICAL
security_level: RESTRICTED
version: "1.0.0"
date: 2026-09-09
status: active
scope: universal
author: Bell Corporate Labs
enforced_by: all agents, all phases
---

# AI_INSTRUCTIONS — Smartware Build Authority

> These directives are non-negotiable architectural guardrails.
> Every AI agent, code-generation tool, or automated pipeline
> operating on the Smartware codebase MUST read and honour this
> file before acting on any other document in this repository.

---

## § 1 — Authority Hierarchy

CORE-DIRECTIVE:AUTHORITY-0   ← this file (highest authority)
SPEC:WIRE-PROTOCOL-v1        ← docs/01_WIRE_PROTOCOL_SPEC.md (planned; not in repo)
ROADMAP:STRATEGY-EVOLUTION   ← docs/02_POST_GA_STRATEGIC_ROADMAP.md
RELEASE:AUDIT-LOG            ← docs/RELEASE_NOTES.md
INTEGRATION:SDK-DEVELOPER    ← docs/integration-guide.md (planned; not in repo)

When documents conflict, higher authority wins.
When silent, default to fail-closed.

---

## § 2 — Universal Build Constraints

| Rule | Enforcement |
|------|-------------|
| No capability that requires operating the customer's cluster may ship as a product feature | Hard block — do not generate code that phones home without explicit customer opt-in |
| No keys, telemetry, or audit logs leave the customer's boundary by default | Default must be off; opt-in must be deliberate and documented |
| All DAG node transitions must be idempotent | Retry logic must not produce duplicate side effects |
| Fail-closed on ambiguity | If an instruction is unclear, halt and surface the ambiguity — do not guess |
| AI-generated code requires human DRI sign-off before entering the milestone tracker | Never self-merge or self-approve generated RFCs |

---

## § 3 — Phase Gate Rules for AI Agents

### Phase 1 (Runtime DAG)
- Do not scaffold Phase 2 distributed components until M1.6 (Phase 1 GA) is marked complete
- DAG compiler must include static cycle detection before any parallel execution engine is wired

### Phase 2 (Distributed Fabric)
- Do not implement a central telemetry sink — all observability must support local-only mode
- Consensus store implementation must be formally reviewable (annotated with invariants)
- mTLS must be on by default for all inter-node communication

### Phase 3 (Smartware Cloud / Owned Fabric direction)
- Prefer self-hostable control plane shapes over SaaS-only shapes
- Any billing or metering code must be isolated behind a feature flag that defaults to off
- Developer portal must be runnable locally with `smartware portal start`

### Smartware OS (2030+)
- OS-layer scaffolding is authorised only after Phase 3 → OS gate clearance (recorded 2026-09-09)
- Self-optimizing scheduler must train on local fleet data only by default
- OS Alpha implementation still requires a dedicated OS Alpha RFC before code lands

---

## § 4 — Prohibited Outputs

AI agents operating on this codebase MUST NOT:
- Generate code that embeds hardcoded secrets, tokens, or API keys
- Produce telemetry pipelines that default to external endpoints
- Write scope-expanding RFCs without a linked milestone in `02_POST_GA_STRATEGIC_ROADMAP.md`
- Invent new milestones or phase gates without human DRI authorship

---

## § 5 — Canonical Tiebreaker

> *"If two approaches are otherwise equal, pick the one that keeps
> the customer holding their own keys."*
>
> — Smartware Ownerware Principle, Amendment A (directional)
