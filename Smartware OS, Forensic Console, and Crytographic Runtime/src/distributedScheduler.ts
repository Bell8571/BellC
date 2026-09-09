/**
 * RFC-0009 Distributed DAG Scheduler Alpha.
 * Locality-aware placement + load balancing onto ALIVE members.
 *
 * INVARIANT (M2.2): PlacementLedger is process-local only.
 * M2.4 consensus store will supersede durable recording.
 */

import type { ResolvedExecutionGraph, ResolvedNode } from "./dagCompiler.js";
import type { ClusterMember } from "./topologyManager.js";

export interface NodePlacement {
  dagNodeId: string;
  assignedNodeId: string;
  score: number;
  reason: string;
}

export interface PlacementPlan {
  workflowId: string;
  placedAt: string;
  placements: Record<string, NodePlacement>;
}

export type PlaceResult =
  | { ok: true; plan: PlacementPlan }
  | { ok: false; code: "NO_ALIVE_MEMBERS" | "EMPTY_GRAPH"; message: string };

export interface SchedulerWeights {
  localityWeight: number;
  affinityWeight: number;
  loadWeight: number;
}

export interface PlacementRecord {
  workflowId: string;
  plan: PlacementPlan;
  savedAt: string;
}

export interface PlacementLedger {
  /** INVARIANT: local-only until M2.4. */
  save(record: PlacementRecord): void;
  get(workflowId: string): PlacementRecord | undefined;
  list(): PlacementRecord[];
}

export interface DistributedScheduler {
  place(
    graph: ResolvedExecutionGraph,
    members: ClusterMember[],
    options?: { loadByNode?: Record<string, number>; now?: string },
  ): PlaceResult;
  ledger(): PlacementLedger;
}

const DEFAULT_WEIGHTS: SchedulerWeights = {
  localityWeight: 0.6,
  affinityWeight: 0.2,
  loadWeight: 0.4,
};

function affinityTags(node: ResolvedNode): string[] {
  const raw = node.config["affinity"];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    return raw as string[];
  }
  return [];
}

function memberTags(member: ClusterMember): Set<string> {
  const tags = new Set<string>();
  for (const [k, v] of Object.entries(member.metadata)) {
    tags.add(k);
    tags.add(v);
  }
  return tags;
}

function aliveMembers(members: ClusterMember[]): ClusterMember[] {
  return members.filter((m) => m.state === "ALIVE").sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

function placementOrder(graph: ResolvedExecutionGraph): string[] {
  const out: string[] = [];
  for (const batch of graph.executionOrder) {
    out.push(...[...batch].sort((a, b) => a.localeCompare(b)));
  }
  return out;
}

export function createPlacementLedger(): PlacementLedger {
  const byWorkflow = new Map<string, PlacementRecord>();
  return {
    save(record) {
      byWorkflow.set(record.workflowId, {
        workflowId: record.workflowId,
        plan: structuredClone(record.plan),
        savedAt: record.savedAt,
      });
    },
    get(workflowId) {
      const r = byWorkflow.get(workflowId);
      return r ? structuredClone(r) : undefined;
    },
    list() {
      return [...byWorkflow.values()].map((r) => structuredClone(r));
    },
  };
}

function scoreCandidate(
  node: ResolvedNode,
  candidate: ClusterMember,
  placed: Record<string, NodePlacement>,
  loadByNode: Record<string, number>,
  maxLoad: number,
  weights: SchedulerWeights,
): { score: number; reason: string } {
  let locality = 0;
  for (const dep of node.dependsOn) {
    if (placed[dep]?.assignedNodeId === candidate.nodeId) {
      locality = 1;
      break;
    }
  }

  const tags = affinityTags(node);
  const mTags = memberTags(candidate);
  const affinity = tags.some((t) => mTags.has(t)) ? 1 : 0;

  const load = loadByNode[candidate.nodeId] ?? 0;
  const normalizedLoad = maxLoad <= 0 ? 0 : load / maxLoad;

  const score =
    weights.localityWeight * locality +
    weights.affinityWeight * affinity -
    weights.loadWeight * normalizedLoad;

  const parts: string[] = [];
  if (locality) parts.push("locality");
  if (affinity) parts.push("affinity");
  parts.push(`load=${load}`);
  return { score, reason: parts.join(",") };
}

export function createDistributedScheduler(
  weights: Partial<SchedulerWeights> = {},
  ledger: PlacementLedger = createPlacementLedger(),
): DistributedScheduler {
  const w: SchedulerWeights = { ...DEFAULT_WEIGHTS, ...weights };

  return {
    ledger: () => ledger,

    place(graph, members, options = {}): PlaceResult {
      const alive = aliveMembers(members);
      if (alive.length === 0) {
        return { ok: false, code: "NO_ALIVE_MEMBERS", message: "no ALIVE cluster members for placement" };
      }
      const order = placementOrder(graph);
      if (order.length === 0) {
        return { ok: false, code: "EMPTY_GRAPH", message: "graph has no placeable nodes" };
      }

      const loadByNode: Record<string, number> = { ...(options.loadByNode ?? {}) };
      for (const m of alive) {
        if (loadByNode[m.nodeId] === undefined) loadByNode[m.nodeId] = 0;
      }

      const placements: Record<string, NodePlacement> = {};
      const placedAt = options.now ?? new Date().toISOString();

      for (const dagNodeId of order) {
        const node = graph.nodes[dagNodeId];
        if (!node) continue;

        let maxLoad = 0;
        for (const m of alive) {
          maxLoad = Math.max(maxLoad, loadByNode[m.nodeId] ?? 0);
        }

        let best: ClusterMember | undefined;
        let bestScore = -Infinity;
        let bestReason = "";

        for (const candidate of alive) {
          const { score, reason } = scoreCandidate(node, candidate, placements, loadByNode, maxLoad, w);
          if (
            !best ||
            score > bestScore ||
            (score === bestScore && candidate.nodeId.localeCompare(best.nodeId) < 0)
          ) {
            best = candidate;
            bestScore = score;
            bestReason = reason;
          }
        }

        if (!best) {
          return { ok: false, code: "NO_ALIVE_MEMBERS", message: "placement lost all candidates" };
        }

        placements[dagNodeId] = {
          dagNodeId,
          assignedNodeId: best.nodeId,
          score: bestScore,
          reason: bestReason,
        };
        loadByNode[best.nodeId] = (loadByNode[best.nodeId] ?? 0) + 1;
      }

      const plan: PlacementPlan = {
        workflowId: graph.workflowId,
        placedAt,
        placements,
      };

      // INVARIANT (M2.2): local ledger only — not replicated.
      ledger.save({ workflowId: graph.workflowId, plan, savedAt: placedAt });

      return { ok: true, plan };
    },
  };
}
