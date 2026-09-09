/**
 * RFC-0024 Smartware OS GA.
 * Ecosystem-as-infrastructure (marketplace deps at resolve time) +
 * global DAG routing without cloud-boundary preference.
 * Local registry only — no phone-home.
 */

import type { MarketplacePackage, MarketplaceRegistry } from "./marketplace.js";

export type GaSubstrateKind = "cloud" | "on-prem" | "edge";

export interface GaSubstrate {
  substrateId: string;
  kind: GaSubstrateKind;
  endpoint: string;
  healthy: boolean;
  /** Lower is better (ms). */
  latencyMs: number;
  healthScore: number;
}

export interface PackageDependencySpec {
  /** Node id in the DAG that needs the package. */
  nodeId: string;
  /** Marketplace package name. */
  packageName: string;
  /** Exact version pin (OS GA v1 — no semver ranges). */
  version: string;
}

export interface ResolvedDependency {
  nodeId: string;
  packageId: string;
  name: string;
  version: string;
  kind: MarketplacePackage["kind"];
  partnerId: string;
  verified: true;
}

export interface GlobalRouteRequest {
  workflowId: string;
  nodeId: string;
  /** Optional affinity tag matching substrateId prefix or kind. */
  preferKind?: GaSubstrateKind;
  /** Pin if healthy (or allowUnhealthyPin). */
  pinSubstrateId?: string;
  allowUnhealthyPin?: boolean;
}

export interface GlobalRouteDecision {
  workflowId: string;
  nodeId: string;
  substrateId: string;
  kind: GaSubstrateKind;
  endpoint: string;
  latencyMs: number;
  reason: string;
}

export type OsGaResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "INVALID"
        | "DENIED"
        | "NOT_FOUND"
        | "UNAVAILABLE"
        | "CONFLICT"
        | "UNSIGNED"
        | "BAD_SIGNATURE";
      message: string;
    };

export interface OsGaRuntimeConfig {
  registry: MarketplaceRegistry;
}

export interface OsGaRuntime {
  registerSubstrate(s: GaSubstrate): OsGaResult<GaSubstrate>;
  setSubstrateHealth(
    substrateId: string,
    patch: Partial<Pick<GaSubstrate, "healthy" | "latencyMs" | "healthScore">>,
  ): OsGaResult<GaSubstrate>;
  listSubstrates(): GaSubstrate[];
  /**
   * Resolve package deps from the local marketplace registry.
   * Every package must verify (signature) before bind.
   */
  resolveDependencies(
    specs: PackageDependencySpec[],
  ): OsGaResult<ResolvedDependency[]>;
  /** Place a node anywhere healthy — no cloud bias. */
  route(request: GlobalRouteRequest): OsGaResult<GlobalRouteDecision>;
}

export function createOsGaRuntime(cfg: OsGaRuntimeConfig): OsGaRuntime {
  const substrates = new Map<string, GaSubstrate>();
  const { registry } = cfg;

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
      if (!["cloud", "on-prem", "edge"].includes(input.kind)) {
        return { ok: false, code: "INVALID", message: "invalid substrate kind" };
      }
      if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) {
        return { ok: false, code: "INVALID", message: "latencyMs must be >= 0" };
      }
      if (
        !Number.isFinite(input.healthScore) ||
        input.healthScore < 0 ||
        input.healthScore > 100
      ) {
        return {
          ok: false,
          code: "INVALID",
          message: "healthScore must be 0–100",
        };
      }
      if (substrates.has(substrateId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `substrate ${substrateId} exists`,
        };
      }
      const record: GaSubstrate = {
        substrateId,
        kind: input.kind,
        endpoint,
        healthy: input.healthy,
        latencyMs: input.latencyMs,
        healthScore: input.healthScore,
      };
      substrates.set(substrateId, record);
      return { ok: true, value: { ...record } };
    },

    setSubstrateHealth(substrateId, patch) {
      const s = substrates.get(substrateId);
      if (!s) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `substrate ${substrateId} not found`,
        };
      }
      if (patch.healthy !== undefined) s.healthy = patch.healthy;
      if (patch.latencyMs !== undefined) {
        if (!Number.isFinite(patch.latencyMs) || patch.latencyMs < 0) {
          return { ok: false, code: "INVALID", message: "latencyMs must be >= 0" };
        }
        s.latencyMs = patch.latencyMs;
      }
      if (patch.healthScore !== undefined) {
        if (
          !Number.isFinite(patch.healthScore) ||
          patch.healthScore < 0 ||
          patch.healthScore > 100
        ) {
          return {
            ok: false,
            code: "INVALID",
            message: "healthScore must be 0–100",
          };
        }
        s.healthScore = patch.healthScore;
      }
      return { ok: true, value: { ...s } };
    },

    listSubstrates() {
      return [...substrates.values()].map((s) => ({ ...s }));
    },

    resolveDependencies(specs) {
      if (!Array.isArray(specs) || specs.length === 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "at least one dependency spec required",
        };
      }
      const resolved: ResolvedDependency[] = [];
      const seenNodes = new Set<string>();

      for (const spec of specs) {
        const nodeId = spec.nodeId?.trim();
        const packageName = spec.packageName?.trim();
        const version = spec.version?.trim();
        if (!nodeId || !packageName || !version) {
          return {
            ok: false,
            code: "INVALID",
            message: "nodeId, packageName, and version required",
          };
        }
        if (seenNodes.has(nodeId)) {
          return {
            ok: false,
            code: "CONFLICT",
            message: `duplicate dependency for node ${nodeId}`,
          };
        }
        seenNodes.add(nodeId);

        const candidates = registry
          .listPackages()
          .filter((p) => p.name === packageName && p.version === version);
        if (candidates.length === 0) {
          return {
            ok: false,
            code: "NOT_FOUND",
            message: `package ${packageName}@${version} not in local registry`,
          };
        }
        /** Deterministic: lowest packageId wins on ties. */
        candidates.sort((a, b) => a.packageId.localeCompare(b.packageId));
        const pkg = candidates[0]!;
        const verify = registry.verify(pkg.packageId);
        if (!verify.ok) {
          return {
            ok: false,
            code: verify.code === "BAD_SIGNATURE" || verify.code === "UNSIGNED"
              ? verify.code
              : "BAD_SIGNATURE",
            message: verify.message,
          };
        }
        resolved.push({
          nodeId,
          packageId: pkg.packageId,
          name: pkg.name,
          version: pkg.version,
          kind: pkg.kind,
          partnerId: pkg.partnerId,
          verified: true,
        });
      }
      return { ok: true, value: resolved };
    },

    route(request) {
      const workflowId = request.workflowId?.trim();
      const nodeId = request.nodeId?.trim();
      if (!workflowId || !nodeId) {
        return {
          ok: false,
          code: "INVALID",
          message: "workflowId and nodeId required",
        };
      }

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
            workflowId,
            nodeId,
            substrateId: pinned.substrateId,
            kind: pinned.kind,
            endpoint: pinned.endpoint,
            latencyMs: pinned.latencyMs,
            reason: "pin",
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
          message: "no healthy substrates",
        };
      }

      /**
       * Global routing: sort by latency, then healthScore desc,
       * then substrateId. Kind is NOT a primary key — no cloud bias.
       */
      candidates.sort((a, b) => {
        if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
        if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
        return a.substrateId.localeCompare(b.substrateId);
      });
      const pick = candidates[0]!;
      return {
        ok: true,
        value: {
          workflowId,
          nodeId,
          substrateId: pick.substrateId,
          kind: pick.kind,
          endpoint: pick.endpoint,
          latencyMs: pick.latencyMs,
          reason: request.preferKind
            ? "prefer-kind-then-latency"
            : "global-lowest-latency",
        },
      };
    },
  };
}
