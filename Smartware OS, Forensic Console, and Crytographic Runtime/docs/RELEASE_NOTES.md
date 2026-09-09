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

## Append Future Releases Below

<!-- later Phase 2 entries append below this line -->
