/**
 * RFC-0026 Neuromorphic edge scheduling research scaffold.
 * Spike-rate / energy-budget placement. Local decisions only.
 */

export interface EdgeNeuron {
  nodeId: string;
  /** Spikes per second (activity). */
  spikeRateHz: number;
  /** Energy cost per spike (arbitrary units). */
  energyPerSpike: number;
  healthy: boolean;
}

export interface NeuromorphicPlaceRequest {
  workflowId: string;
  /** Estimated spikes this placement will emit. */
  estimatedSpikes: number;
}

export interface NeuromorphicPlaceDecision {
  workflowId: string;
  nodeId: string;
  projectedEnergy: number;
  remainingBudget: number;
  reason: string;
}

export type NeuroResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "UNAVAILABLE" | "BUDGET_EXCEEDED" | "CONFLICT";
      message: string;
    };

export interface NeuromorphicEdgeSchedulerConfig {
  /** Total energy budget for the local edge fleet. */
  energyBudget: number;
}

export interface NeuromorphicEdgeScheduler {
  registerNeuron(n: EdgeNeuron): NeuroResult<EdgeNeuron>;
  listNeurons(): EdgeNeuron[];
  remainingBudget(): number;
  place(req: NeuromorphicPlaceRequest): NeuroResult<NeuromorphicPlaceDecision>;
}

export function createNeuromorphicEdgeScheduler(
  cfg: NeuromorphicEdgeSchedulerConfig,
): NeuromorphicEdgeScheduler {
  if (!Number.isFinite(cfg.energyBudget) || cfg.energyBudget < 0) {
    throw new Error("energyBudget must be >= 0");
  }
  let budget = cfg.energyBudget;
  const neurons = new Map<string, EdgeNeuron>();

  return {
    registerNeuron(input) {
      const nodeId = input.nodeId?.trim();
      if (!nodeId) {
        return { ok: false, code: "INVALID", message: "nodeId required" };
      }
      if (!Number.isFinite(input.spikeRateHz) || input.spikeRateHz < 0) {
        return { ok: false, code: "INVALID", message: "spikeRateHz must be >= 0" };
      }
      if (!Number.isFinite(input.energyPerSpike) || input.energyPerSpike < 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "energyPerSpike must be >= 0",
        };
      }
      if (neurons.has(nodeId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `neuron ${nodeId} exists`,
        };
      }
      const record: EdgeNeuron = {
        nodeId,
        spikeRateHz: input.spikeRateHz,
        energyPerSpike: input.energyPerSpike,
        healthy: input.healthy,
      };
      neurons.set(nodeId, record);
      return { ok: true, value: { ...record } };
    },

    listNeurons() {
      return [...neurons.values()].map((n) => ({ ...n }));
    },

    remainingBudget() {
      return budget;
    },

    place(req) {
      const workflowId = req.workflowId?.trim();
      if (!workflowId) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      if (!Number.isFinite(req.estimatedSpikes) || req.estimatedSpikes < 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "estimatedSpikes must be >= 0",
        };
      }

      const candidates = [...neurons.values()].filter((n) => n.healthy);
      if (candidates.length === 0) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "no healthy edge neurons",
        };
      }

      /**
       * Projected energy = estimatedSpikes * energyPerSpike.
       * Prefer lowest projected energy, then highest spikeRate
       * (more headroom for activity), then nodeId.
       */
      const ranked = candidates
        .map((n) => ({
          n,
          projected: req.estimatedSpikes * n.energyPerSpike,
        }))
        .sort((a, b) => {
          if (a.projected !== b.projected) return a.projected - b.projected;
          if (b.n.spikeRateHz !== a.n.spikeRateHz) {
            return b.n.spikeRateHz - a.n.spikeRateHz;
          }
          return a.n.nodeId.localeCompare(b.n.nodeId);
        });

      const best = ranked[0]!;
      if (best.projected > budget) {
        return {
          ok: false,
          code: "BUDGET_EXCEEDED",
          message: `projected ${best.projected} exceeds budget ${budget}`,
        };
      }
      budget -= best.projected;
      return {
        ok: true,
        value: {
          workflowId,
          nodeId: best.n.nodeId,
          projectedEnergy: best.projected,
          remainingBudget: budget,
          reason: "lowest-projected-energy",
        },
      };
    },
  };
}
