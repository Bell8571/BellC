/**
 * RFC-0017 Multi-Region Fabric + Global Routing.
 * Latency-aware active-active / active-passive routing.
 * Self-hostable endpoints only. No phone-home.
 */

export type FabricMode = "active-active" | "active-passive";

export type RegionRole = "active" | "standby";

export interface Region {
  regionId: string;
  displayName: string;
  /** Customer-controlled endpoint — never a hardcoded SaaS collector. */
  endpoint: string;
  clusterId?: string;
  healthy: boolean;
  role: RegionRole;
}

export interface RouteRequest {
  workflowId: string;
  /** Preferred source region for locality; optional. */
  sourceRegionId?: string;
  /** Affinity pin; fail if unhealthy unless allowUnhealthyPin. */
  pinRegionId?: string;
  allowUnhealthyPin?: boolean;
}

export interface RouteDecision {
  regionId: string;
  endpoint: string;
  estimatedLatencyMs: number;
  /** Added cost vs best healthy active region. */
  overheadMs: number;
  withinSla: boolean;
  fabricMode: FabricMode;
  reason: string;
}

export type MultiRegionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID" | "CONFLICT" | "UNAVAILABLE";
      message: string;
    };

export interface MultiRegionSnapshot {
  fabricMode: FabricMode;
  overheadBudgetMs: number;
  regions: Region[];
  latencySamples: number;
}

export interface MultiRegionFabricConfig {
  mode?: FabricMode;
  /** Cross-region overhead SLA. Default 20. */
  overheadBudgetMs?: number;
}

export interface MultiRegionFabric {
  mode(): FabricMode;
  registerRegion(region: Omit<Region, "healthy"> & { healthy?: boolean }): MultiRegionResult<Region>;
  setHealthy(regionId: string, healthy: boolean): MultiRegionResult<Region>;
  /** Record RTT from → to in milliseconds. */
  recordLatency(fromRegionId: string, toRegionId: string, rttMs: number): MultiRegionResult<void>;
  route(request: RouteRequest): MultiRegionResult<RouteDecision>;
  listRegions(): Region[];
  snapshot(): MultiRegionSnapshot;
}

function cloneRegion(r: Region): Region {
  return { ...r };
}

export function createMultiRegionFabric(
  cfg: MultiRegionFabricConfig = {},
): MultiRegionFabric {
  const fabricMode: FabricMode = cfg.mode ?? "active-active";
  const overheadBudgetMs = cfg.overheadBudgetMs ?? 20;
  const regions = new Map<string, Region>();
  /** key `${from}\0${to}` → latest RTT ms */
  const latency = new Map<string, number>();

  const latKey = (from: string, to: string): string => `${from}\0${to}`;

  const estimateLatency = (source: string | undefined, target: string): number => {
    if (!source || source === target) return 0;
    const direct = latency.get(latKey(source, target));
    if (direct !== undefined) return direct;
    const reverse = latency.get(latKey(target, source));
    if (reverse !== undefined) return reverse;
    /** Unknown path — treat as over-budget so operator must probe. */
    return overheadBudgetMs + 1;
  };

  const candidates = (): Region[] => {
    const all = [...regions.values()].filter((r) => r.healthy);
    if (fabricMode === "active-active") {
      return all.filter((r) => r.role === "active");
    }
    const actives = all.filter((r) => r.role === "active");
    if (actives.length > 0) return actives;
    return all.filter((r) => r.role === "standby");
  };

  return {
    mode: () => fabricMode,

    registerRegion(input) {
      const regionId = input.regionId?.trim();
      const displayName = input.displayName?.trim();
      const endpoint = input.endpoint?.trim();
      if (!regionId || !displayName || !endpoint) {
        return {
          ok: false,
          code: "INVALID",
          message: "regionId, displayName, and endpoint required",
        };
      }
      if (regions.has(regionId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `region ${regionId} already registered`,
        };
      }
      if (fabricMode === "active-passive" && input.role === "active") {
        const existingActive = [...regions.values()].some((r) => r.role === "active");
        if (existingActive) {
          return {
            ok: false,
            code: "CONFLICT",
            message: "active-passive allows only one active region",
          };
        }
      }
      const region: Region = {
        regionId,
        displayName,
        endpoint,
        clusterId: input.clusterId,
        healthy: input.healthy ?? true,
        role: input.role,
      };
      regions.set(regionId, region);
      return { ok: true, value: cloneRegion(region) };
    },

    setHealthy(regionId, healthy) {
      const r = regions.get(regionId);
      if (!r) {
        return { ok: false, code: "NOT_FOUND", message: `region ${regionId} not found` };
      }
      r.healthy = healthy;
      return { ok: true, value: cloneRegion(r) };
    },

    recordLatency(fromRegionId, toRegionId, rttMs) {
      if (!regions.has(fromRegionId) || !regions.has(toRegionId)) {
        return { ok: false, code: "NOT_FOUND", message: "unknown region in latency sample" };
      }
      if (!Number.isFinite(rttMs) || rttMs < 0) {
        return { ok: false, code: "INVALID", message: "rttMs must be a non-negative number" };
      }
      latency.set(latKey(fromRegionId, toRegionId), rttMs);
      return { ok: true, value: undefined };
    },

    route(request) {
      if (!request.workflowId?.trim()) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      if (request.pinRegionId) {
        const pinned = regions.get(request.pinRegionId);
        if (!pinned) {
          return {
            ok: false,
            code: "NOT_FOUND",
            message: `pin region ${request.pinRegionId} not found`,
          };
        }
        if (!pinned.healthy && !request.allowUnhealthyPin) {
          return {
            ok: false,
            code: "UNAVAILABLE",
            message: `pinned region ${pinned.regionId} unhealthy`,
          };
        }
        const estimatedLatencyMs = estimateLatency(request.sourceRegionId, pinned.regionId);
        const pool = candidates();
        const best =
          pool.length === 0
            ? estimatedLatencyMs
            : Math.min(...pool.map((r) => estimateLatency(request.sourceRegionId, r.regionId)));
        const overheadMs = Math.max(0, estimatedLatencyMs - best);
        return {
          ok: true,
          value: {
            regionId: pinned.regionId,
            endpoint: pinned.endpoint,
            estimatedLatencyMs,
            overheadMs,
            withinSla: overheadMs <= overheadBudgetMs,
            fabricMode,
            reason: "pinned",
          },
        };
      }

      const pool = candidates();
      if (pool.length === 0) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "no healthy routable regions",
        };
      }

      let best = pool[0]!;
      let bestLat = estimateLatency(request.sourceRegionId, best.regionId);
      for (let i = 1; i < pool.length; i++) {
        const r = pool[i]!;
        const lat = estimateLatency(request.sourceRegionId, r.regionId);
        if (lat < bestLat || (lat === bestLat && r.regionId < best.regionId)) {
          best = r;
          bestLat = lat;
        }
      }
      const overheadMs = 0; // chosen best → zero added overhead by definition
      return {
        ok: true,
        value: {
          regionId: best.regionId,
          endpoint: best.endpoint,
          estimatedLatencyMs: bestLat,
          overheadMs,
          withinSla: overheadMs <= overheadBudgetMs,
          fabricMode,
          reason:
            fabricMode === "active-passive" && best.role === "standby"
              ? "failover-standby"
              : "lowest-latency",
        },
      };
    },

    listRegions() {
      return [...regions.values()].map(cloneRegion);
    },

    snapshot() {
      return {
        fabricMode,
        overheadBudgetMs,
        regions: [...regions.values()].map(cloneRegion),
        latencySamples: latency.size,
      };
    },
  };
}
