---
label: PHASE:SMARTWARE-CLOUD-v1
classification: NORMATIVE
security_level: INTERNAL
version: "1.0.0"
date: 2026-09-09
phase: 3
window: "Q3 2028 – Q4 2029"
status: authorised
depends_on: "Phase 2 GA (M2.6)"
owner: Cloud Platform Team
authority: CORE-DIRECTIVE:AUTHORITY-0
amendment_direction: Amendment A (ownerware — directional only)
phase_gate_cleared_from_phase_2: "2026-09-09"
phase_gate_cleared_by: "Bell Corporate Labs (DRI)"
---

# Phase 3 — Smartware Cloud

> Managed, multi-region cloud platform built on the Phase 2
> distributed fabric. Serverless DAG execution, developer portal,
> marketplace, and enterprise compliance.
>
> **Phase gate:** Phase 2 → Phase 3 cleared 2026-09-09 by DRI
> (Bell Corporate Labs). Phase 3 scaffolding on `main` is authorised.
>
> **M3.1 status:** Managed Control Plane Alpha complete in-repo
> (RFC-0014).
> **M3.2 status:** Serverless DAG Execution Beta complete in-repo
> (RFC-0015).
> **M3.3 status:** Developer Portal v1 complete in-repo (RFC-0016).
> SOC 2 Type II audit prep clock started with M3.3.
> **M3.4 status:** Multi-Region Fabric + Global Routing complete (RFC-0017).
> **M3.5 status:** Enterprise Security complete (RFC-0018). SOC 2 Type II
> *prep controls* evidenced in-repo; certification remains auditor-owned.
> **M3.6 status:** Marketplace Launch complete (RFC-0019).
> **M3.7 status:** AI Scheduler + Billing Engine complete (RFC-0020).
> Billing metering defaults OFF; AI trains locally only.
> Do not scaffold M3.8 until directed.

---

## AI Build Instructions

TASK: Implement the Smartware Cloud platform layer.
READ: docs/AI_INSTRUCTIONS.md before writing any code.
PREREQUISITE: M2.6 (Phase 2 GA) verified — **cleared 2026-09-09**.
OWNERWARE TIEBREAKER: When two approaches are equal,
prefer the one that can run self-hosted. See § 5 of
docs/AI_INSTRUCTIONS.md.
BILLING: All metering/billing code lives behind a feature
flag that defaults to OFF. Never co-locate billing logic
with core execution paths.
COMPLIANCE: Audit prep must begin at M3.3 (6-month lead
required for SOC 2 Type II cycle).
SERVERLESS: Container/WASM runtime abstraction must be
in place before M3.2 scaffolding begins.
AI SCHEDULER: Trains on local fleet telemetry only by
default. No central trace aggregation without opt-in.

---

## Core Capabilities

### Managed Control Plane
Cloud-hosted control plane for cluster lifecycle management,
rolling upgrades, scaling policy, and global routing.
API shape designed to be portable to self-hosted deployments
(ownerware direction).

### Serverless DAG Execution
On-demand, scale-to-zero DAG node execution. Sub-second
cold-start target (P99 < 500ms). No infrastructure management
required from the developer. Backed by WASM or container runtime.

### Multi-Region Fabric
Active-active or active-passive DAG execution across geographic
regions. Latency-aware routing with < 20ms added cross-region
overhead.

### Developer Portal
Web-based portal: visual DAG editor, live monitoring, cost
dashboards, team collaboration. Must be runnable locally with
`smartware portal start` (ownerware tiebreaker applied).

### Marketplace & Ecosystem
Plugin/integration marketplace. Third-party developers publish
DAG node packages, connectors, and templates. Signed packages
with customer-mirrorable registry.

### Enterprise Security
SSO/SAML, audit logging, SOC 2 Type II, ISO 27001, data
residency controls, customer-managed encryption keys.

### Usage-Based Billing Engine
Metering at DAG node execution level. Budget alerts, cost
forecasting. Feature-flagged off by default.

### AI-Augmented Scheduling
ML-based workload prediction and DAG pre-warming. Trains on
customer's own fleet telemetry, on the customer's infrastructure.
Optional anonymized baseline model published by Smartware team.

---

## Milestones

| ID | Milestone | Target | Description |
|----|-----------|--------|-------------|
| M3.1 | Managed Control Plane Alpha | Aug 2028 | Cluster lifecycle, upgrade orchestration |
| M3.2 | Serverless DAG Execution Beta | Oct 2028 | Scale-to-zero, WASM/container runtime |
| M3.3 | Developer Portal v1 | Dec 2028 | Visual editor, monitoring, local-run support |
| M3.4 | Multi-Region Fabric + Global Routing | Mar 2029 | Active-active, latency-aware routing |
| M3.5 | Enterprise Security + SOC 2 Type II | Jun 2029 | SSO, audit, compliance certification |
| M3.6 | Marketplace Launch | Aug 2029 | Signed package registry, partner onboarding |
| M3.7 | AI Scheduler + Billing Engine GA | Oct 2029 | Local-trained scheduler; metered billing |
| M3.8 | Smartware Cloud GA | Dec 2029 | Phase gate review; Smartware OS green-light |

---

## Related RFCs

| Milestone | RFC | Status |
|-----------|-----|--------|
| M3.1 | `docs/rfcs/0014-managed-control-plane.md` | accepted |
| M3.2 | `docs/rfcs/0015-serverless-dag-runtime.md` | accepted |
| M3.3 | `docs/rfcs/0016-developer-portal.md` | accepted |
| M3.4 | `docs/rfcs/0017-multi-region-fabric.md` | accepted |
| M3.5 | `docs/rfcs/0018-enterprise-security.md` | accepted |
| M3.6 | `docs/rfcs/0019-marketplace-registry.md` | accepted |
| M3.7 | `docs/rfcs/0020-ai-scheduler-billing.md` | accepted |

---

## Dependencies

- Phase 2 GA (M2.6) verified before any Phase 3 work enters main — **cleared 2026-09-09**
- Container/WASM runtime abstraction before M3.2
- Global anycast network layer and latency SLA defined before M3.4 — **delivered in RFC-0017** (20ms overhead budget)
- SOC 2 audit prep begins at M3.3 (6-month lead time) — **started 2026-09-09 with M3.3**
- AI scheduler baseline model quality bar set before M3.7 — **round-robin beat gate in RFC-0020**

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Platform uptime per region | 99.99% |
| Serverless cold-start (P99) | < 500 ms |
| Cross-region routing overhead | < 20 ms |
| Developer onboarding (signup → first workflow) | < 10 minutes |
| Marketplace packages at GA | 100+ |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Compliance certification delays | High | High | Begin audit prep at M3.3 without exception |
| WASM runtime immaturity for production use | Medium | High | Container fallback path maintained in parallel |
| AI scheduler cold-start baseline quality | Medium | Medium | Baseline must beat round-robin on reference set before M3.7 |
| Marketplace trust and package quality | Medium | Medium | Signed packages + automated security scanning |
| Scope drift toward full SaaS org structure | High | High | Prime Directive check at every M3.x phase gate |
