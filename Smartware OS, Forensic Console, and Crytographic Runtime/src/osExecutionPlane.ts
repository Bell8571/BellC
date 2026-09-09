/**
 * RFC-0022 Smartware OS Alpha — Unified Execution Plane.
 * Cloud + on-prem only. Edge deferred to OS Beta.
 * Self-optimizing scheduler trains on local fleet data only.
 */

import {
  createAiScheduler,
  type AiScheduler,
  type FleetSample,
} from "./aiScheduler.js";

export type SubstrateKind = "cloud" | "on-prem";

/** Edge is OS Beta — not accepted in Alpha. */
export type ForbiddenSubstrateKind = "edge";

export interface Substrate {
  substrateId: string;
  kind: SubstrateKind;
  endpoint: string;
  healthy: boolean;
  /** Optional capacity hint (higher = more room). */
  capacity?: number;
}

export interface PlaceWorkflowRequest {
  workflowId: string;
  /** Optional node type key for optimizer learning. Default "workflow". */
  nodeKey?: string;
  /** Optional preference; plane may still fail-closed if unhealthy. */
  preferKind?: SubstrateKind;
  /** Pin to a specific substrate if healthy (or allowUnhealthyPin). */
  pinSubstrateId?: string;
  allowUnhealthyPin?: boolean;
}

export interface PlaceWorkflowDecision {
  workflowId: string;
  substrateId: string;
  kind: SubstrateKind;
  endpoint: string;
  preferAi: boolean;
  reason: string;
}

export type OsPlaneResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE" | "CONFLICT";
      message: string;
    };

export interface SelfOptimizingScheduler {
  record(sample: FleetSample): void;
  recommend(nodeKey: string, candidateHostIds: string[]): ReturnType<AiScheduler["recommend"]>;
  sampleCount(): number;
}

export interface OsExecutionPlaneConfig {
  /** Injected for tests; defaults to local AI scheduler. */
  scheduler?: SelfOptimizingScheduler;
}

export interface OsExecutionPlane {
  /** Alpha: cloud | on-prem only. */
  registerSubstrate(substrate: Substrate): OsPlaneResult<Substrate>;
  setHealthy(substrateId: string, healthy: boolean): OsPlaneResult<Substrate>;
  listSubstrates(): Substrate[];
  place(request: PlaceWorkflowRequest): OsPlaneResult<PlaceWorkflowDecision>;
  /** Record observed placement cost for local learning. */
  observe(sample: FleetSample): void;
  scheduler(): SelfOptimizingScheduler;
}

function createDefaultScheduler(): SelfOptimizingScheduler {
  const ai = createAiScheduler({ minSamples: 3 });
  return {
    record: (s) => ai.record(s),
    recommend: (nodeKey, hosts) => ai.recommend(nodeKey, hosts),
    sampleCount: () => ai.sampleCount(),
  };
}

export function createOsExecutionPlane(
  cfg: OsExecutionPlaneConfig = {},
): OsExecutionPlane {
  const scheduler = cfg.scheduler ?? createDefaultScheduler();
  const substrates = new Map<string, Substrate>();

  return {
    registerSubstrate(input) {
      const substrateId = input.substrateId?.trim();
      const endpoint = input.endpoint?.trim();
      if (!substrateId || !endpoint) {
        return {
          ok: false,
          code: "INVALID",
          message: "substrateId and endpoint required",
        };
      }
      if (input.kind !== "cloud" && input.kind !== "on-prem") {
        return {
          ok: false,
          code: "DENIED",
          message: "OS Alpha accepts only cloud | on-prem (edge is OS Beta)",
        };
      }
      if (substrates.has(substrateId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `substrate ${substrateId} already registered`,
        };
      }
      const record: Substrate = {
        substrateId,
        kind: input.kind,
        endpoint,
        healthy: input.healthy ?? true,
        capacity: input.capacity,
      };
      substrates.set(substrateId, record);
      return { ok: true, value: { ...record } };
    },

    setHealthy(substrateId, healthy) {
      const s = substrates.get(substrateId);
      if (!s) {
        return { ok: false, code: "NOT_FOUND", message: `substrate ${substrateId} not found` };
      }
      s.healthy = healthy;
      return { ok: true, value: { ...s } };
    },

    listSubstrates() {
      return [...substrates.values()].map((s) => ({ ...s }));
    },

    place(request) {
      if (!request.workflowId?.trim()) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      const nodeKey = request.nodeKey?.trim() || "workflow";

      if (request.pinSubstrateId) {
        const pinned = substrates.get(request.pinSubstrateId);
        if (!pinned) {
          return {
            ok: false,
            code: "NOT_FOUND",
            message: `substrate ${request.pinSubstrateId} not found`,
          };
        }
        if (!pinned.healthy && !request.allowUnhealthyPin) {
          return {
            ok: false,
            code: "UNAVAILABLE",
            message: `pinned substrate ${pinned.substrateId} unhealthy`,
          };
        }
        return {
          ok: true,
          value: {
            workflowId: request.workflowId,
            substrateId: pinned.substrateId,
            kind: pinned.kind,
            endpoint: pinned.endpoint,
            preferAi: false,
            reason: "pinned",
          },
        };
      }

      let candidates = [...substrates.values()].filter((s) => s.healthy);
      if (request.preferKind) {
        const preferred = candidates.filter((s) => s.kind === request.preferKind);
        if (preferred.length > 0) candidates = preferred;
      }
      if (candidates.length === 0) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "no healthy substrates in OS Alpha plane",
        };
      }

      const hostIds = candidates.map((s) => s.substrateId);
      const rec = scheduler.recommend(nodeKey, hostIds);
      const chosenId = rec.preferAi ? rec.aiHostId : rec.roundRobinHostId;
      const chosen =
        candidates.find((s) => s.substrateId === chosenId) ?? candidates[0]!;

      return {
        ok: true,
        value: {
          workflowId: request.workflowId,
          substrateId: chosen.substrateId,
          kind: chosen.kind,
          endpoint: chosen.endpoint,
          preferAi: rec.preferAi,
          reason: rec.preferAi
            ? "self-optimizing-ai"
            : rec.reason === "insufficient-samples"
              ? "baseline-round-robin"
              : "baseline-round-robin",
        },
      };
    },

    observe(sample) {
      scheduler.record(sample);
    },

    scheduler: () => scheduler,
  };
}
