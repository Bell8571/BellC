/**
 * RFC-0020 Billing Engine — SEPARATE from execution / AI scheduler.
 * meteringEnabled defaults FALSE (Authority-0 Phase 3).
 * No phone-home. Local meters only unless export explicitly added later.
 */

export interface MeterEvent {
  id: string;
  at: string;
  namespaceId: string;
  workflowId: string;
  nodeId: string;
  /** Billable units (e.g. node-execution count or duration ms). */
  units: number;
  unitKind: "node-execution" | "duration-ms";
}

export interface BudgetAlert {
  namespaceId: string;
  limitUnits: number;
  usedUnits: number;
  at: string;
}

export interface BillingEngineConfig {
  /**
   * Authority-0: MUST default false.
   * When false, record() is a no-op success and query returns empty.
   */
  meteringEnabled?: boolean;
  now?: () => number;
  idFactory?: () => string;
}

export type BillingResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "DISABLED" | "INVALID" | "BUDGET_EXCEEDED";
      message: string;
    };

export interface BillingEngine {
  meteringEnabled(): boolean;
  /** Enable/disable at runtime; still defaults off at construction. */
  setMeteringEnabled(enabled: boolean): void;
  setBudget(namespaceId: string, limitUnits: number): BillingResult<void>;
  record(
    event: Omit<MeterEvent, "id" | "at"> & { at?: string },
  ): BillingResult<MeterEvent | { skipped: true }>;
  usage(namespaceId: string): number;
  alerts(): BudgetAlert[];
  listMeters(filter?: { namespaceId?: string; workflowId?: string }): MeterEvent[];
}

export function createBillingEngine(cfg: BillingEngineConfig = {}): BillingEngine {
  let meteringEnabled = cfg.meteringEnabled ?? false;
  const now = cfg.now ?? (() => Date.now());
  const idFactory =
    cfg.idFactory ??
    (() => `mtr-${Math.random().toString(36).slice(2, 10)}`);

  const events: MeterEvent[] = [];
  const budgets = new Map<string, number>();
  const usageByNs = new Map<string, number>();
  const alertLog: BudgetAlert[] = [];

  return {
    meteringEnabled: () => meteringEnabled,

    setMeteringEnabled(enabled) {
      meteringEnabled = enabled;
    },

    setBudget(namespaceId, limitUnits) {
      if (!namespaceId.trim()) {
        return { ok: false, code: "INVALID", message: "namespaceId required" };
      }
      if (!Number.isFinite(limitUnits) || limitUnits < 0) {
        return { ok: false, code: "INVALID", message: "limitUnits must be >= 0" };
      }
      budgets.set(namespaceId, limitUnits);
      return { ok: true, value: undefined };
    },

    record(event) {
      if (!meteringEnabled) {
        return { ok: true, value: { skipped: true } };
      }
      if (
        !event.namespaceId?.trim() ||
        !event.workflowId?.trim() ||
        !event.nodeId?.trim()
      ) {
        return {
          ok: false,
          code: "INVALID",
          message: "namespaceId, workflowId, and nodeId required",
        };
      }
      if (!Number.isFinite(event.units) || event.units < 0) {
        return { ok: false, code: "INVALID", message: "units must be >= 0" };
      }
      const ns = event.namespaceId.trim();
      const used = (usageByNs.get(ns) ?? 0) + event.units;
      const limit = budgets.get(ns);
      if (limit !== undefined && used > limit) {
        const alert: BudgetAlert = {
          namespaceId: ns,
          limitUnits: limit,
          usedUnits: used,
          at: new Date(now()).toISOString(),
        };
        alertLog.push(alert);
        return {
          ok: false,
          code: "BUDGET_EXCEEDED",
          message: `namespace ${ns} budget ${limit} exceeded (would be ${used})`,
        };
      }
      const entry: MeterEvent = {
        id: idFactory(),
        at: event.at ?? new Date(now()).toISOString(),
        namespaceId: ns,
        workflowId: event.workflowId.trim(),
        nodeId: event.nodeId.trim(),
        units: event.units,
        unitKind: event.unitKind,
      };
      events.push(entry);
      usageByNs.set(ns, used);
      return { ok: true, value: { ...entry } };
    },

    usage(namespaceId) {
      return usageByNs.get(namespaceId) ?? 0;
    },

    alerts() {
      return alertLog.map((a) => ({ ...a }));
    },

    listMeters(filter) {
      return events
        .filter((e) => {
          if (filter?.namespaceId && e.namespaceId !== filter.namespaceId) return false;
          if (filter?.workflowId && e.workflowId !== filter.workflowId) return false;
          return true;
        })
        .map((e) => ({ ...e }));
    },
  };
}
