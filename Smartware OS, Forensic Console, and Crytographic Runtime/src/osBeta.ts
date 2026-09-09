/**
 * RFC-0023 Smartware OS Beta.
 * Edge substrates, pluggable runtime kernels, autonomous fault healing.
 * Local health signals only — no phone-home oracle.
 */

export type BetaSubstrateKind = "cloud" | "on-prem" | "edge";

export type KernelKind = "wasm" | "jvm" | "native" | "gpu";

export interface BetaSubstrate {
  substrateId: string;
  kind: BetaSubstrateKind;
  endpoint: string;
  healthy: boolean;
  /** 0–100 local health score; healer migrates below threshold. */
  healthScore: number;
}

export interface KernelRegistration {
  kind: KernelKind;
  /** Human label / version string. */
  version: string;
  /** Optional node-type affinity tags. */
  affinityTags?: string[];
}

export interface KernelSelection {
  kernel: KernelKind;
  version: string;
  reason: string;
}

export interface HealingMigration {
  workflowId: string;
  fromSubstrateId: string;
  toSubstrateId: string;
  at: string;
  reason: string;
}

export type OsBetaResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "NOT_FOUND" | "UNAVAILABLE" | "CONFLICT";
      message: string;
    };

export interface OsBetaPlaneConfig {
  /** Health score below this triggers migration. Default 40. */
  healThreshold?: number;
  now?: () => number;
}

export interface OsBetaPlane {
  registerSubstrate(s: Omit<BetaSubstrate, "healthScore"> & { healthScore?: number }): OsBetaResult<BetaSubstrate>;
  setHealth(substrateId: string, healthy: boolean, healthScore?: number): OsBetaResult<BetaSubstrate>;
  registerKernel(reg: KernelRegistration): OsBetaResult<KernelRegistration>;
  selectKernel(opts: {
    nodeType?: string;
    annotation?: KernelKind;
  }): OsBetaResult<KernelSelection>;
  /**
   * If substrate healthScore < threshold, pick a healthier target
   * and record a migration. Local signals only.
   */
  healIfNeeded(workflowId: string, currentSubstrateId: string): OsBetaResult<HealingMigration | { skipped: true }>;
  listMigrations(): HealingMigration[];
  listSubstrates(): BetaSubstrate[];
  listKernels(): KernelRegistration[];
}

export function createOsBetaPlane(cfg: OsBetaPlaneConfig = {}): OsBetaPlane {
  const healThreshold = cfg.healThreshold ?? 40;
  const now = cfg.now ?? (() => Date.now());

  const substrates = new Map<string, BetaSubstrate>();
  const kernels = new Map<KernelKind, KernelRegistration>();
  const migrations: HealingMigration[] = [];

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
      if (substrates.has(substrateId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `substrate ${substrateId} exists`,
        };
      }
      const score = input.healthScore ?? (input.healthy === false ? 0 : 100);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return {
          ok: false,
          code: "INVALID",
          message: "healthScore must be 0–100",
        };
      }
      const record: BetaSubstrate = {
        substrateId,
        kind: input.kind,
        endpoint,
        healthy: input.healthy ?? score > 0,
        healthScore: score,
      };
      substrates.set(substrateId, record);
      return { ok: true, value: { ...record } };
    },

    setHealth(substrateId, healthy, healthScore) {
      const s = substrates.get(substrateId);
      if (!s) {
        return { ok: false, code: "NOT_FOUND", message: `substrate ${substrateId} not found` };
      }
      s.healthy = healthy;
      if (healthScore !== undefined) {
        if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100) {
          return { ok: false, code: "INVALID", message: "healthScore must be 0–100" };
        }
        s.healthScore = healthScore;
      } else if (!healthy) {
        s.healthScore = Math.min(s.healthScore, healThreshold - 1);
      }
      return { ok: true, value: { ...s } };
    },

    registerKernel(reg) {
      if (!["wasm", "jvm", "native", "gpu"].includes(reg.kind)) {
        return { ok: false, code: "INVALID", message: "invalid kernel kind" };
      }
      if (!reg.version?.trim()) {
        return { ok: false, code: "INVALID", message: "version required" };
      }
      if (kernels.has(reg.kind)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `kernel ${reg.kind} already registered`,
        };
      }
      const stored: KernelRegistration = {
        kind: reg.kind,
        version: reg.version.trim(),
        affinityTags: reg.affinityTags ? [...reg.affinityTags] : undefined,
      };
      kernels.set(reg.kind, stored);
      return { ok: true, value: { ...stored, affinityTags: stored.affinityTags ? [...stored.affinityTags] : undefined } };
    },

    selectKernel(opts) {
      if (opts.annotation) {
        const k = kernels.get(opts.annotation);
        if (!k) {
          return {
            ok: false,
            code: "NOT_FOUND",
            message: `annotated kernel ${opts.annotation} not registered`,
          };
        }
        return {
          ok: true,
          value: {
            kernel: k.kind,
            version: k.version,
            reason: "node-annotation",
          },
        };
      }
      if (opts.nodeType) {
        for (const k of kernels.values()) {
          if (k.affinityTags?.includes(opts.nodeType)) {
            return {
              ok: true,
              value: {
                kernel: k.kind,
                version: k.version,
                reason: "affinity-tag",
              },
            };
          }
        }
      }
      /** Default preference order for Beta. */
      const order: KernelKind[] = ["wasm", "native", "jvm", "gpu"];
      for (const kind of order) {
        const k = kernels.get(kind);
        if (k) {
          return {
            ok: true,
            value: { kernel: k.kind, version: k.version, reason: "default-order" },
          };
        }
      }
      return { ok: false, code: "UNAVAILABLE", message: "no kernels registered" };
    },

    healIfNeeded(workflowId, currentSubstrateId) {
      if (!workflowId.trim()) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      const current = substrates.get(currentSubstrateId);
      if (!current) {
        return {
          ok: false,
          code: "NOT_FOUND",
          message: `substrate ${currentSubstrateId} not found`,
        };
      }
      if (current.healthScore >= healThreshold && current.healthy) {
        return { ok: true, value: { skipped: true } };
      }
      const targets = [...substrates.values()]
        .filter(
          (s) =>
            s.substrateId !== current.substrateId &&
            s.healthy &&
            s.healthScore >= healThreshold,
        )
        .sort((a, b) => {
          if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
          return a.substrateId.localeCompare(b.substrateId);
        });
      if (targets.length === 0) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "no healthy migration target",
        };
      }
      const to = targets[0]!;
      const migration: HealingMigration = {
        workflowId: workflowId.trim(),
        fromSubstrateId: current.substrateId,
        toSubstrateId: to.substrateId,
        at: new Date(now()).toISOString(),
        reason: `healthScore ${current.healthScore} < ${healThreshold}`,
      };
      migrations.push(migration);
      return { ok: true, value: { ...migration } };
    },

    listMigrations() {
      return migrations.map((m) => ({ ...m }));
    },

    listSubstrates() {
      return [...substrates.values()].map((s) => ({ ...s }));
    },

    listKernels() {
      return [...kernels.values()].map((k) => ({
        ...k,
        affinityTags: k.affinityTags ? [...k.affinityTags] : undefined,
      }));
    },
  };
}
