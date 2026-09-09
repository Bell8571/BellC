/**
 * RFC-0012 Fault-tolerant execution — checkpoints + placement failover.
 * Reassigns only DAG nodes placed on DEAD/EVICTED members.
 */

import type { ResolvedExecutionGraph } from "./dagCompiler.js";
import {
  createDistributedScheduler,
  type DistributedScheduler,
  type NodePlacement,
  type PlacementPlan,
} from "./distributedScheduler.js";
import type { ClusterMember, MembershipState } from "./topologyManager.js";

export type SplitBrainPolicy = "refuse_writes" | "allow_local";

export interface WorkflowCheckpoint {
  workflowId: string;
  namespaceId: string;
  plan: PlacementPlan;
  completedNodeIds: string[];
  savedAt: string;
}

export interface FailoverReassignment {
  dagNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  reason: string;
}

export type FailoverResult =
  | {
      ok: true;
      plan: PlacementPlan;
      reassignments: FailoverReassignment[];
      checkpoint: WorkflowCheckpoint;
    }
  | {
      ok: false;
      code: "NO_ALIVE_MEMBERS" | "SPLIT_BRAIN" | "UNKNOWN_PLACEMENT" | "EMPTY";
      message: string;
    };

export interface FailoverController {
  saveCheckpoint(cp: WorkflowCheckpoint): void;
  loadCheckpoint(workflowId: string): WorkflowCheckpoint | undefined;
  /**
   * Re-place DAG nodes assigned to lost members onto ALIVE members.
   * Completed nodes are left unchanged.
   */
  failover(args: {
    graph: ResolvedExecutionGraph;
    plan: PlacementPlan;
    members: ClusterMember[];
    namespaceId: string;
    completedNodeIds?: string[];
    clusterSize?: number;
    now?: string;
  }): FailoverResult;
}

const LOST: ReadonlySet<MembershipState> = new Set(["DEAD", "EVICTED"]);

function quorum(n: number): number {
  return Math.floor(n / 2) + 1;
}

export function createFailoverController(options?: {
  splitBrainPolicy?: SplitBrainPolicy;
  scheduler?: DistributedScheduler;
}): FailoverController {
  const splitBrainPolicy: SplitBrainPolicy = options?.splitBrainPolicy ?? "refuse_writes";
  const scheduler = options?.scheduler ?? createDistributedScheduler();
  const checkpoints = new Map<string, WorkflowCheckpoint>();

  return {
    saveCheckpoint(cp) {
      checkpoints.set(cp.workflowId, {
        ...cp,
        completedNodeIds: [...cp.completedNodeIds],
        plan: {
          ...cp.plan,
          placements: Object.fromEntries(
            Object.entries(cp.plan.placements).map(([k, v]) => [k, { ...v }]),
          ),
        },
      });
    },

    loadCheckpoint(workflowId) {
      const cp = checkpoints.get(workflowId);
      return cp
        ? {
            ...cp,
            completedNodeIds: [...cp.completedNodeIds],
            plan: {
              ...cp.plan,
              placements: Object.fromEntries(
                Object.entries(cp.plan.placements).map(([k, v]) => [k, { ...v }]),
              ),
            },
          }
        : undefined;
    },

    failover(args): FailoverResult {
      const {
        graph,
        plan,
        members,
        namespaceId,
        completedNodeIds = [],
        clusterSize = members.length,
        now = new Date().toISOString(),
      } = args;

      const alive = members.filter((m) => m.state === "ALIVE");
      if (alive.length === 0) {
        return { ok: false, code: "NO_ALIVE_MEMBERS", message: "no ALIVE members for failover" };
      }

      // Split-brain: refuse when alive count below quorum of configured cluster size.
      if (splitBrainPolicy === "refuse_writes" && alive.length < quorum(Math.max(clusterSize, 1))) {
        return {
          ok: false,
          code: "SPLIT_BRAIN",
          message: `alive ${alive.length} < quorum ${quorum(clusterSize)}; refuse_writes`,
        };
      }

      const completed = new Set(completedNodeIds);
      const memberById = new Map(members.map((m) => [m.nodeId, m]));
      const nextPlacements: Record<string, NodePlacement> = {
        ...Object.fromEntries(Object.entries(plan.placements).map(([k, v]) => [k, { ...v }])),
      };
      const reassignments: FailoverReassignment[] = [];

      const toReplace: string[] = [];
      for (const [dagNodeId, placement] of Object.entries(plan.placements)) {
        if (completed.has(dagNodeId)) continue;
        const host = memberById.get(placement.assignedNodeId);
        if (!host || LOST.has(host.state)) {
          toReplace.push(dagNodeId);
        }
      }

      if (toReplace.length === 0 && Object.keys(plan.placements).length === 0) {
        return { ok: false, code: "EMPTY", message: "no placements to failover" };
      }

      // Build a mini-graph order for nodes needing reassignment; score against current load.
      const loadByNode: Record<string, number> = {};
      for (const m of alive) loadByNode[m.nodeId] = 0;
      for (const [dagNodeId, p] of Object.entries(nextPlacements)) {
        if (toReplace.includes(dagNodeId)) continue;
        if (completed.has(dagNodeId)) continue;
        const host = memberById.get(p.assignedNodeId);
        if (host?.state === "ALIVE") {
          loadByNode[p.assignedNodeId] = (loadByNode[p.assignedNodeId] ?? 0) + 1;
        }
      }

      // Sub-graph: only nodes to replace, preserving dependsOn from full graph for locality.
      const subNodes: ResolvedExecutionGraph["nodes"] = {};
      for (const id of toReplace) {
        const node = graph.nodes[id];
        if (node) subNodes[id] = node;
      }
      const subGraph: ResolvedExecutionGraph = {
        workflowId: graph.workflowId,
        compiledAt: graph.compiledAt,
        compilerVersion: graph.compilerVersion,
        metadata: graph.metadata,
        nodes: subNodes,
        executionOrder: graph.executionOrder
          .map((batch) => batch.filter((id) => toReplace.includes(id)))
          .filter((b) => b.length > 0),
      };

      if (toReplace.length > 0) {
        const placed = scheduler.place(subGraph, alive, { loadByNode, now });
        if (!placed.ok) {
          return { ok: false, code: "NO_ALIVE_MEMBERS", message: placed.message };
        }
        for (const id of toReplace) {
          const neu = placed.plan.placements[id];
          if (!neu) continue;
          const prev = plan.placements[id]!;
          nextPlacements[id] = neu;
          reassignments.push({
            dagNodeId: id,
            fromNodeId: prev.assignedNodeId,
            toNodeId: neu.assignedNodeId,
            reason: `host ${prev.assignedNodeId} lost; ${neu.reason}`,
          });
        }
      }

      const newPlan: PlacementPlan = {
        workflowId: plan.workflowId,
        placedAt: now,
        placements: nextPlacements,
      };

      const checkpoint: WorkflowCheckpoint = {
        workflowId: plan.workflowId,
        namespaceId,
        plan: newPlan,
        completedNodeIds: [...completed],
        savedAt: now,
      };
      checkpoints.set(checkpoint.workflowId, checkpoint);

      return { ok: true, plan: newPlan, reassignments, checkpoint };
    },
  };
}
