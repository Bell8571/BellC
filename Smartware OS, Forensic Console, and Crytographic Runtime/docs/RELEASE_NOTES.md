---
label: RELEASE:AUDIT-LOG-v1.0.0
classification: PUBLIC
security_level: AUDITABLE
version: "1.0.0"
date: 2026-09-09
status: baseline-spec
phase: 0
author: Bell Corporate Labs
---

# Release Notes — Smartware v1.0.0 Baseline Spec

> This repository is the **specification tree** for Smartware.
> The table below is the intended **v1.0.0 GA product surface**,
> not evidence that binaries, SDKs, or a 30-day burn-in exist
> in this repo. All post-GA phases build on this baseline.
>
> Future version sections below the v1.0.0 block are append-only.
> Do not rewrite past version entries; add new headings instead.

---

## v1.0.0 — GA Surface (September 2026)

### Specified Surface

| Feature | Status | Notes |
|---------|--------|-------|
| Core runtime engine | Specified GA | Stable single-node execution |
| Basic task scheduler | Specified GA | Linear queue; replaced by DAG in Phase 1 |
| Plugin API v1 | Specified GA | Frozen at baseline; schema export in RFC-0006 / M1.1 |
| CLI tooling | Specified GA | `smartware run`, `smartware inspect`, `smartware logs` |
| SDK (TypeScript/Go) | Specified GA | DAG DSL added in Phase 1 (M1.3) |
| Single-node execution model | Specified GA | Multi-node in Phase 2 |
| Developer documentation | Specified GA | See `docs/integration-guide.md` (planned; not in repo) |
| Distributed execution | Not in GA | Phase 2 |
| DAG-native scheduling | Not in GA | Phase 1 |
| Cloud-native primitives | Not in GA | Phase 3 |

### Known Limitations Addressed in Post-GA Phases

- Linear scheduler becomes a bottleneck above ~500 concurrent tasks (Phase 1)
- No cross-host workload distribution (Phase 2)
- No managed control plane or serverless primitives (Phase 3)
- No self-optimizing scheduling (Smartware OS)

### GA Success Criteria (specified for the baseline; not verified in this repository)

- Zero P0 bugs in 30-day burn-in
- Plugin API backward compatibility guaranteed for 24 months
- CLI round-trip latency < 50ms on reference hardware
- SDK published to npm and pkg.go.dev

---

## v1.1.0-alpha — M1.1 DAG Compiler (2026-09-09)

Alpha **library** in this repository. Not a GA runtime, not a verified ship.

| Feature | Status | Notes |
|---------|--------|-------|
| Plugin API v1 registry | Alpha | RFC-0006: `createNodeTypeRegistry()`, in-process only |
| `parse()` JSON/YAML | Alpha | RFC-0001; never throws |
| `compile()` + Kahn cycle detection | Alpha | RFC-0001; fail-closed; cap 10_000 nodes |
| `smartware compile <file>` | Alpha | Thin wrapper; `SMARTWARE_DAG_COMPILER=0` exits 2 |
| Graph optimiser (serial-chain merge) | Deferred | Stretch in RFC-0001; metadata still populated |
| Dependency Resolver / parallel engine | Not started | M1.2 / M1.3; cycle tests must keep passing first |

---

## v1.6.0-phase1 — Phase 1 Runtime DAG Alpha (2026-09-09)

Alpha **library** covering M1.1–M1.6 surfaces in this repository. Not a verified product GA ship; Phase 1 → Phase 2 gate still requires human DRI review.

| Feature | Status | Notes |
|---------|--------|-------|
| Plugin API + DAG Compiler | Alpha | RFC-0006 / RFC-0001 |
| Dependency Resolver | Alpha | RFC-0002; in-memory transitions |
| Parallel Execution Engine | Alpha | RFC-0003; worker pool + back-pressure |
| DAG Visualizer | Alpha | RFC-0004; consumer-only frames / text render |
| Branching + local triggers | Alpha | RFC-0005; predicates, if/switch/loop, webhook/queue |
| Durable resolver snapshots | Alpha | RFC-0007; opt-in local JSON only |
| `runWorkflow` runtime wiring | Alpha | Resolver ↔ Engine event loop |
| Regression suite | Alpha | `npm test` covers compile, resolver, engine, visualizer, branching, durable, triggers |

---

## v2.1.0-m21 — Cluster Topology Manager Alpha (2026-09-09)

Phase 1 → Phase 2 gate cleared by DRI. M2.1 alpha library.

| Feature | Status | Notes |
|---------|--------|-------|
| Phase gate Phase 1 → 2 | Cleared | 2026-09-09 · Bell Corporate Labs |
| RFC-0008 Topology Manager | Accepted | Heartbeat, join/evacuate/evict, SUSPECT→DEAD |
| In-process transport | Alpha | Test / single-process simulation only |
| mTLS default | Enforced | Network transport factory fail-closed without cert/key/ca |

---

## v2.2.0-m22 — Distributed DAG Scheduler Alpha (2026-09-09)

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0009 Distributed Scheduler | Accepted | Locality, affinity, load balance |
| ALIVE-only placement | Alpha | Fail-closed if no ALIVE members |
| PlacementLedger | Alpha stub | Process-local; M2.4 will replace |

---

## v2.3.0-m23 — Smartware Message Bus v1 Alpha (2026-09-09)

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0010 Message Bus | Accepted | At-least-once, backlog replay |
| Idempotent publish ids | Alpha | Duplicate id is a no-op |
| Consumer reconnect / replayFrom | Alpha | Unacked redelivery; seq replay |
| External broker | Not used | In-cluster local engine only |

---

## v2.4.0-m24 — Distributed State Store Alpha (2026-09-09)

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0011 Consensus KV | Accepted | Raft-inspired; invariants I1–I5 inline |
| Leader election | Alpha | Majority quorum; single leader per term |
| Replicated commit | Alpha | KV visible only after commit (I3) |
| External etcd/Consul | Not used | In-cluster simulator only |

---

## v2.5.0-m25 — Fault Tolerance + Multi-Tenancy Alpha (2026-09-09)

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0012 | Accepted | Failover, checkpoints, RBAC, namespaces |
| RBAC schema | v1 | viewer / operator / admin; deny-by-default |
| Namespace quotas | Alpha | maxConcurrentWorkflows, maxPlacedNodes |
| Placement failover | Alpha | Reassign DEAD/EVICTED hosts; completed nodes kept |
| Split-brain policy | Alpha | Default refuse_writes below quorum |

---

## v2.6.0-phase2 — Observability + Phase 2 GA Surface (2026-09-09)

Phase 2 milestones M2.1–M2.6 are present as an alpha library. **Not** a verified production GA ship.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0013 Observability | Accepted | Spans, metrics, logs |
| Local-only default | Alpha | `export.enabled` defaults false |
| Opt-in export | Alpha | Requires customer endpoint; fail-closed if missing |
| Central SaaS telemetry | Prohibited | No hardcoded collectors |
| Phase 2 → Phase 3 gate | Cleared | 2026-09-09 by DRI (Bell Corporate Labs) |

---

## Phase gate — Phase 2 → Phase 3 (2026-09-09)

Human DRI cleared the Phase 2 → Phase 3 gate in session ("clear phase 2"). Consensus-store invariant review accepted under that clearance. Phase 3 scaffolding is authorised; no M3.x code yet.

---

## v3.1.0-m31 — Managed Control Plane Alpha (2026-09-09)

Phase 3 M3.1 library surface. Self-hostable control plane API; no phone-home; no billing.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0014 Control Plane | Accepted | Cluster lifecycle, scaling, rolling upgrade |
| createCluster / registerNode | Alpha | Fail-closed on maxNodes / decommissioned |
| Scaling policy reconcile | Alpha | Emits add/remove intents only |
| Rolling upgrade | Alpha | Workers first, control nodes last |
| Cloud VM provisioning | Out of scope | M3.1 alpha is orchestration state only |
| M3.2 Serverless | Blocked | Do not scaffold until directed |

---

## v3.2.0-m32 — Serverless DAG Execution Beta (2026-09-09)

Phase 3 M3.2 library surface. Runtime abstraction with scale-to-zero; metering off by default.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0015 Serverless Runtime | Accepted | inprocess / container / wasm adapters |
| Scale-to-zero | Alpha | idle TTL reclaim + explicit scaleToZero |
| Cold-start budget | Alpha | Default 500ms; overruns counted locally |
| Metering | Opt-in | `meteringEnabled` defaults false; local buffer only |
| Real OCI/wasmtime | Stub | Adapter contract normative; engines deferred |
| M3.3 Developer Portal | Blocked | Do not scaffold until directed |

---

## v3.3.0-m33 — Developer Portal v1 (2026-09-09)

Phase 3 M3.3 library surface. Local portal via `smartware portal start`. SOC 2 audit prep clock started.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0016 Developer Portal | Accepted | Editor + compile preview + monitor |
| `smartware portal start` | Alpha | Default `127.0.0.1:8787` |
| Non-loopback bind | Deny | Requires `--allow-remote` |
| Phone-home / remote CDN | Prohibited | Inline CSS/JS only |
| SOC 2 Type II prep | Started | M3.3 kickoff 2026-09-09 |
| M3.4 Multi-Region | Blocked | Do not scaffold until directed |

---

## v3.4.0-m34 — Multi-Region Fabric + Global Routing (2026-09-09)

Phase 3 M3.4 library surface. Latency-aware routing; self-hostable endpoints; 20ms overhead SLA.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0017 Multi-Region Fabric | Accepted | active-active / active-passive |
| Latency-aware route() | Alpha | Lowest healthy candidate |
| Overhead SLA | Alpha | Default budget 20ms; pins report withinSla |
| Failover | Alpha | Standby used when active unhealthy (passive) |
| Phone-home anycast SaaS | Prohibited | Customer endpoints only |
| M3.5 Enterprise Security | Blocked | Do not scaffold until directed |

---

## v3.5.0-m35 — Enterprise Security + SOC 2 Prep (2026-09-09)

Phase 3 M3.5 library surface. SSO/SAML, audit, CMEK, residency, SOC 2 control register.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0018 Enterprise Security | Accepted | Customer IdP + CMEK refs |
| SAML acceptAssertion | Alpha | HMAC assertion; customer metadata |
| Audit log | Alpha | Local default; export opt-in |
| CMEK | Alpha | Opaque handles only — no private key storage |
| Data residency | Alpha | Fail-closed allowlists |
| SOC 2 Type II certified | False | Controls tracked; auditor sign-off required |
| M3.6 Marketplace | Blocked | Do not scaffold until directed |

---

## v3.6.0-m36 — Marketplace Launch (2026-09-09)

Phase 3 M3.6 library surface. Signed packages, partner onboarding, customer-mirrorable registry.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0019 Marketplace Registry | Accepted | node-type / connector / template |
| Partner onboarding | Alpha | pending → approved → publish |
| Package signing | Alpha | HMAC over manifest; verify required |
| Registry mirror | Alpha | exportMirror / importMirror for air-gap |
| Phone-home SaaS registry | Prohibited | Local/customer-operated default |
| M3.7 AI Scheduler + Billing | Blocked | Do not scaffold until directed |

---

## v3.7.0-m37 — AI Scheduler + Billing Engine (2026-09-09)

Phase 3 M3.7 library surface. Local AI placement training; billing metering off by default.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0020 AI + Billing | Accepted | Separate modules |
| AI scheduler | Alpha | Local fleet samples only; preferAi iff beats round-robin |
| Billing engine | Alpha | `meteringEnabled` defaults false |
| Budget alerts | Alpha | Fail-closed when over limit (if metering on) |
| Billing in execution path | Prohibited | No import into engine / AI scheduler |
| M3.8 Cloud GA | Blocked | Do not scaffold until directed |

---

## v3.8.0-phase3 — Smartware Cloud GA Surface (2026-09-09)

Phase 3 milestones M3.1–M3.8 are present as an alpha library. **Not** a verified production GA ship.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0021 Cloud GA | Accepted | `runPhase3GaChecklist()` |
| M3.1–M3.7 surface checks | Alpha | Construct + ownerware defaults |
| Phase 3 → OS gate | Cleared | 2026-09-09 by DRI (Bell Corporate Labs) |
| OS scaffolding | Authorised | No OS Alpha code until directed + OS Alpha RFC |

---

## Phase gate — Phase 3 → Smartware OS (2026-09-09)

Human DRI cleared the Phase 3 → Smartware OS gate in session ("clear phase 3"). Design-partner production bar accepted under that clearance. OS Alpha still requires a dedicated RFC before implementation.

---

## v4.0.0-os-alpha — Smartware OS Alpha (2026-09-09)

Unified execution plane (cloud + on-prem) with local self-optimizing scheduler v1.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0022 OS Alpha | Accepted | Unified plane + local optimizer |
| Substrates | Alpha | `cloud` \| `on-prem` only |
| Edge substrates | Denied | OS Beta |
| Self-optimizing place() | Alpha | Uses local AI scheduler; beats round-robin gate |
| Research tracks | Blocked | Separate RFCs required |
| OS Beta | Directed | See v4.1.0-os-beta |

---

## v4.1.0-os-beta — Smartware OS Beta (2026-09-09)

Edge substrates, pluggable runtime kernels, autonomous fault healing (local health signals only).

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0023 OS Beta | Accepted | Edge + kernels + healing |
| Edge substrates | Beta | Allowed on `OsBetaPlane` (Alpha still denies) |
| Kernels | Beta | `wasm` \| `jvm` \| `native` \| `gpu` |
| Autonomous healing | Beta | Migrate when healthScore < threshold |
| OS GA | Directed | See v5.0.0-os-ga |
| Research tracks | Blocked | Separate RFCs required |

---

## v5.0.0-os-ga — Smartware OS GA (2026-09-09)

Ecosystem-as-infrastructure (marketplace deps at resolve time) and global DAG routing without cloud-boundary preference.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0024 OS GA | Accepted | Ecosystem + global routing |
| Dependency resolve | GA | Local registry; verify signature before bind |
| Global route | GA | Latency/health across cloud \| on-prem \| edge; no cloud bias |
| Phone-home registry | Denied | Customer mirror only by default |
| Research tracks | Partial | Formal / neuromorphic / decentralized — see v5.1.0-research; AI Co-Pilot still blocked |

---

## v5.1.0-research — Research tracks (2026-09-09)

Three research scaffolds directed by DRI (formal verification, neuromorphic edge, decentralized consensus). AI Co-Pilot remains RFC-gated.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0025 Formal Verification | Accepted | Local invariant checkers for DAG + consensus traces |
| RFC-0026 Neuromorphic Edge | Accepted | Spike/energy budget edge placement |
| RFC-0027 Decentralized Consensus | Accepted | Multi-org quorum attestation; no coordinator org |
| AI Co-Pilot | Directed | See v5.2.0-copilot |

---

## v5.2.0-copilot — AI Co-Pilot research (2026-09-09)

Workflow authoring + optimisation assistant. Providers: **Grok**, **Gemini**, **local**. Default disabled; customer-held keys only.

| Feature | Status | Notes |
|---------|--------|-------|
| RFC-0028 AI Co-Pilot | Accepted | Authoring + optimisation |
| Provider `local` | Research | Offline rule-based; no network |
| Provider `grok` | Research | xAI chat completions; customer apiKey |
| Provider `gemini` | Research | Google generateContent; customer apiKey |
| Default enabled | Denied | Fail-closed until `enabled: true` |
| Smartware-hosted keys | Denied | Ownerware — customer holds keys |

---

## Append Future Releases Below

<!-- later entries append below this line -->
