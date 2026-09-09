# Smartware documentation index

Paths are from the repository root. Files marked *planned; not in repo* are ranked in the authority hierarchy but have not been added yet — do not invent them.

| File | Label | Purpose |
| --- | --- | --- |
| `AGENTS.md` | `AGENT-CONTEXT:ROOT-ENTRY` | Agent load order, phase gates, RFC protocol |
| `docs/AI_INSTRUCTIONS.md` | `CORE-DIRECTIVE:AUTHORITY-0` | Build guardrails, authority hierarchy, prohibited outputs |
| `docs/01_WIRE_PROTOCOL_SPEC.md` | `SPEC:WIRE-PROTOCOL-v1` | Wire protocol (*planned; not in repo*) |
| `docs/02_POST_GA_STRATEGIC_ROADMAP.md` | `ROADMAP:STRATEGY-EVOLUTION` | Master index, dependency map, governance |
| `docs/03_PHASE_1_RUNTIME_DAG.md` | `PHASE:RUNTIME-DAG-v1` | DAG compiler through Phase 1 GA |
| `docs/04_PHASE_2_DISTRIBUTED_FABRIC.md` | `PHASE:DISTRIBUTED-FABRIC-v1` | Cluster, message bus, consensus, observability |
| `docs/05_PHASE_3_SMARTWARE_CLOUD.md` | `PHASE:SMARTWARE-CLOUD-v1` | Platform, serverless, marketplace, AI scheduler |
| `docs/06_SMARTWARE_OS_EVOLUTION.md` | `OS:STRATEGY-NORTH-STAR` | Vision, sub-phases, R&D tracks |
| `docs/RELEASE_NOTES.md` | `RELEASE:AUDIT-LOG-v1.0.0` | Baseline spec of the v1.0.0 GA *surface* (docs tree; not in-repo binaries) |
| `docs/integration-guide.md` | `INTEGRATION:SDK-DEVELOPER` | SDK / developer integration (*planned; not in repo*) |

## Phase 2 RFCs

| File | RFC | Milestone | Status |
| --- | --- | --- | --- |
| `docs/rfcs/0008-cluster-topology-manager.md` | RFC-0008 Cluster Topology Manager | M2.1 | accepted |
| `docs/rfcs/0009-distributed-dag-scheduler.md` | RFC-0009 Distributed DAG Scheduler | M2.2 | accepted |
| `docs/rfcs/0010-smartware-message-bus.md` | RFC-0010 Smartware Message Bus | M2.3 | accepted |

## Phase 1 RFCs

RFC-0001 through RFC-0007 are `accepted` (DRI: Bell Corporate Labs). Phase 1 → Phase 2 gate cleared 2026-09-09.

| File | RFC | Milestone | Status |
| --- | --- | --- | --- |
| `docs/rfcs/0000-template.md` | Template (do not edit) | — | — |
| `docs/rfcs/0006-plugin-api.md` | RFC-0006 Plugin API v1 | M1.1 | accepted |
| `docs/rfcs/0001-dag-compiler.md` | RFC-0001 DAG Compiler | M1.1 | accepted |
| `docs/rfcs/0002-dependency-resolver.md` | RFC-0002 Dependency Resolver | M1.2 | accepted |
| `docs/rfcs/0003-parallel-execution-engine.md` | RFC-0003 Parallel Execution Engine | M1.3 | accepted |
| `docs/rfcs/0004-dag-visualizer.md` | RFC-0004 DAG Visualizer | M1.4 | accepted |
| `docs/rfcs/0005-conditional-branching-events.md` | RFC-0005 Branching + Event Triggers | M1.5 | accepted |
| `docs/rfcs/0007-durable-resolver-state.md` | RFC-0007 Durable Resolver State | M1.6 | accepted |
