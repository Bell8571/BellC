/**
 * RFC-0020 AI Scheduler — local fleet training only.
 * No phone-home. No central trace aggregation by default.
 * Must beat round-robin on reference samples before preferAi.
 */

export interface FleetSample {
  /** DAG node type or node id key used for learning. */
  nodeKey: string;
  hostId: string;
  /** Lower is better (e.g. duration ms). */
  costMs: number;
  at?: string;
}

export interface AiPlacementScore {
  hostId: string;
  predictedCostMs: number;
  sampleCount: number;
}

export interface AiRecommendResult {
  preferAi: boolean;
  orderedHosts: AiPlacementScore[];
  roundRobinHostId: string;
  aiHostId: string;
  aiMeanCost: number;
  roundRobinMeanCost: number;
  reason: string;
}

export interface AiSchedulerConfig {
  /** Minimum samples per (nodeKey, host) before trusting AI. Default 3. */
  minSamples?: number;
}

export interface AiScheduler {
  /** Ingest local fleet telemetry only. */
  record(sample: FleetSample): void;
  sampleCount(): number;
  /**
   * Recommend host order for nodeKey among candidates.
   * preferAi is true only when AI mean cost < round-robin mean on held history.
   */
  recommend(nodeKey: string, candidateHostIds: string[]): AiRecommendResult;
  /** Mean predicted cost for nodeKey on host, or undefined if unknown. */
  predict(nodeKey: string, hostId: string): number | undefined;
  clear(): void;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return Number.POSITIVE_INFINITY;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function createAiScheduler(cfg: AiSchedulerConfig = {}): AiScheduler {
  const minSamples = cfg.minSamples ?? 3;
  /** key `${nodeKey}\0${hostId}` → costs */
  const history = new Map<string, number[]>();
  let total = 0;

  const key = (nodeKey: string, hostId: string): string => `${nodeKey}\0${hostId}`;

  const costsFor = (nodeKey: string, hostId: string): number[] =>
    history.get(key(nodeKey, hostId)) ?? [];

  return {
    record(sample) {
      if (!sample.nodeKey?.trim() || !sample.hostId?.trim()) return;
      if (!Number.isFinite(sample.costMs) || sample.costMs < 0) return;
      const k = key(sample.nodeKey.trim(), sample.hostId.trim());
      const arr = history.get(k) ?? [];
      arr.push(sample.costMs);
      history.set(k, arr);
      total += 1;
    },

    sampleCount: () => total,

    predict(nodeKey, hostId) {
      const xs = costsFor(nodeKey, hostId);
      if (xs.length === 0) return undefined;
      return mean(xs);
    },

    recommend(nodeKey, candidateHostIds) {
      const hosts = [...new Set(candidateHostIds.filter((h) => h.trim().length > 0))];
      if (hosts.length === 0) {
        return {
          preferAi: false,
          orderedHosts: [],
          roundRobinHostId: "",
          aiHostId: "",
          aiMeanCost: Number.POSITIVE_INFINITY,
          roundRobinMeanCost: Number.POSITIVE_INFINITY,
          reason: "no candidates",
        };
      }

      const scores: AiPlacementScore[] = hosts.map((hostId) => {
        const xs = costsFor(nodeKey, hostId);
        return {
          hostId,
          predictedCostMs: xs.length ? mean(xs) : Number.POSITIVE_INFINITY,
          sampleCount: xs.length,
        };
      });

      scores.sort((a, b) => {
        if (a.predictedCostMs !== b.predictedCostMs) {
          return a.predictedCostMs - b.predictedCostMs;
        }
        return a.hostId.localeCompare(b.hostId);
      });

      /** Round-robin proxy: lexicographically first host (stable baseline). */
      const rrHost = [...hosts].sort((a, b) => a.localeCompare(b))[0]!;
      const rrCosts = costsFor(nodeKey, rrHost);
      const rrMean = rrCosts.length ? mean(rrCosts) : Number.POSITIVE_INFINITY;

      const aiBest = scores[0]!;
      const aiMean = aiBest.predictedCostMs;
      const trusted = aiBest.sampleCount >= minSamples;

      const preferAi =
        trusted &&
        Number.isFinite(aiMean) &&
        Number.isFinite(rrMean) &&
        aiMean < rrMean;

      return {
        preferAi,
        orderedHosts: scores,
        roundRobinHostId: rrHost,
        aiHostId: aiBest.hostId,
        aiMeanCost: aiMean,
        roundRobinMeanCost: rrMean,
        reason: preferAi
          ? "ai-beats-round-robin"
          : !trusted
            ? "insufficient-samples"
            : "insufficient-improvement",
      };
    },

    clear() {
      history.clear();
      total = 0;
    },
  };
}
