/**
 * RFC-0015 Serverless DAG Execution Beta.
 * Runtime abstraction (inprocess | container | wasm), scale-to-zero,
 * cold-start budget tracking. Metering defaults OFF. No phone-home.
 */

export type RuntimeKind = "inprocess" | "container" | "wasm";

export type InstanceState = "warming" | "warm" | "busy" | "draining";

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  warm(): Promise<{ instanceId: string }>;
  invoke(
    instanceId: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<{ output?: unknown }>;
  dispose(instanceId: string): Promise<void>;
}

export interface ServerlessInvokeRequest {
  workflowId: string;
  nodeId: string;
  payload: unknown;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface ServerlessInvokeResult {
  ok: boolean;
  output?: unknown;
  coldStart: boolean;
  durationMs: number;
  coldStartMs: number;
  instanceId: string;
  kind: RuntimeKind;
  withinColdStartBudget: boolean;
  error?: string;
}

export interface MeteringEvent {
  workflowId: string;
  nodeId: string;
  idempotencyKey: string;
  durationMs: number;
  coldStart: boolean;
  at: string;
}

export interface ServerlessSnapshot {
  kind: RuntimeKind;
  warmIdle: number;
  busy: number;
  totalInstances: number;
  coldStartCount: number;
  coldStartBudgetMs: number;
  coldStartsOverBudget: number;
  meteringEnabled: boolean;
  meteringEventCount: number;
}

export interface ServerlessRuntimeConfig {
  adapter: RuntimeAdapter;
  /** Soft cap on warm+busy instances. Default 32. */
  maxInstances?: number;
  /** Dispose idle warm instances after this. Default 30_000. */
  idleTtlMs?: number;
  /** Cold-start latency budget (P99 target). Default 500. */
  coldStartBudgetMs?: number;
  /**
   * Authority-0: metering/billing MUST default OFF.
   * When true, events stay local only — never exported.
   */
  meteringEnabled?: boolean;
  now?: () => number;
}

export interface ServerlessRuntime {
  kind(): RuntimeKind;
  invoke(req: ServerlessInvokeRequest): Promise<ServerlessInvokeResult>;
  /** Optional pre-warm; no-ops if already at count. */
  ensureWarm(count: number): Promise<void>;
  scaleToZero(): Promise<void>;
  /** Reclaim idle warm instances past TTL. */
  tick(): Promise<void>;
  snapshot(): ServerlessSnapshot;
  /** Local metering buffer; empty unless meteringEnabled. */
  meteringEvents(): MeteringEvent[];
}

interface PoolEntry {
  instanceId: string;
  state: InstanceState;
  lastUsedAt: number;
}

/** In-process adapter — default local/dev and unit tests. */
export function createInProcessAdapter(
  idFactory: () => string = () => `inp-${Math.random().toString(36).slice(2, 10)}`,
): RuntimeAdapter {
  const live = new Set<string>();
  return {
    kind: "inprocess",
    async warm() {
      const instanceId = idFactory();
      live.add(instanceId);
      return { instanceId };
    },
    async invoke(instanceId, payload) {
      if (!live.has(instanceId)) {
        throw new Error(`unknown instance ${instanceId}`);
      }
      return { output: payload };
    },
    async dispose(instanceId) {
      live.delete(instanceId);
    },
  };
}

/**
 * Container adapter stub — normative kind surface for beta.
 * Executes in-process; real OCI spawn is deferred.
 */
export function createContainerAdapterStub(
  idFactory: () => string = () => `ctr-${Math.random().toString(36).slice(2, 10)}`,
): RuntimeAdapter {
  const base = createInProcessAdapter(idFactory);
  return {
    kind: "container",
    warm: () => base.warm(),
    invoke: (id, payload, signal) => base.invoke(id, payload, signal),
    dispose: (id) => base.dispose(id),
  };
}

/**
 * WASM adapter stub — normative kind surface for beta.
 * Executes in-process; real wasmtime embed is deferred.
 */
export function createWasmAdapterStub(
  idFactory: () => string = () => `wasm-${Math.random().toString(36).slice(2, 10)}`,
): RuntimeAdapter {
  const base = createInProcessAdapter(idFactory);
  return {
    kind: "wasm",
    warm: () => base.warm(),
    invoke: (id, payload, signal) => base.invoke(id, payload, signal),
    dispose: (id) => base.dispose(id),
  };
}

export function createServerlessRuntime(cfg: ServerlessRuntimeConfig): ServerlessRuntime {
  const adapter = cfg.adapter;
  const maxInstances = cfg.maxInstances ?? 32;
  const idleTtlMs = cfg.idleTtlMs ?? 30_000;
  const coldStartBudgetMs = cfg.coldStartBudgetMs ?? 500;
  const meteringEnabled = cfg.meteringEnabled ?? false;
  const now = cfg.now ?? (() => Date.now());

  const pool = new Map<string, PoolEntry>();
  const seenKeys = new Set<string>();
  const idempotentResults = new Map<string, ServerlessInvokeResult>();
  let coldStartCount = 0;
  let coldStartsOverBudget = 0;
  const metering: MeteringEvent[] = [];

  const pickIdleWarm = (): PoolEntry | undefined => {
    for (const entry of pool.values()) {
      if (entry.state === "warm") return entry;
    }
    return undefined;
  };

  const disposeEntry = async (entry: PoolEntry): Promise<void> => {
    entry.state = "draining";
    pool.delete(entry.instanceId);
    await adapter.dispose(entry.instanceId);
  };

  const coldStart = async (): Promise<{ entry: PoolEntry; coldStartMs: number }> => {
    if (pool.size >= maxInstances) {
      throw new Error(`maxInstances ${maxInstances} reached`);
    }
    const t0 = now();
    const { instanceId } = await adapter.warm();
    const coldStartMs = Math.max(0, now() - t0);
    coldStartCount += 1;
    if (coldStartMs > coldStartBudgetMs) {
      coldStartsOverBudget += 1;
    }
    const entry: PoolEntry = {
      instanceId,
      state: "warm",
      lastUsedAt: now(),
    };
    pool.set(instanceId, entry);
    return { entry, coldStartMs };
  };

  return {
    kind: () => adapter.kind,

    async invoke(req) {
      if (!req.idempotencyKey?.trim()) {
        return {
          ok: false,
          coldStart: false,
          durationMs: 0,
          coldStartMs: 0,
          instanceId: "",
          kind: adapter.kind,
          withinColdStartBudget: true,
          error: "idempotencyKey required",
        };
      }
      const prior = idempotentResults.get(req.idempotencyKey);
      if (prior) {
        return { ...prior };
      }
      if (seenKeys.has(req.idempotencyKey)) {
        return {
          ok: false,
          coldStart: false,
          durationMs: 0,
          coldStartMs: 0,
          instanceId: "",
          kind: adapter.kind,
          withinColdStartBudget: true,
          error: "in-flight duplicate idempotencyKey",
        };
      }
      seenKeys.add(req.idempotencyKey);

      const tInvoke = now();
      let coldStartFlag = false;
      let coldStartMs = 0;
      let entry = pickIdleWarm();
      try {
        if (!entry) {
          coldStartFlag = true;
          const started = await coldStart();
          entry = started.entry;
          coldStartMs = started.coldStartMs;
        }
        entry.state = "busy";
        const signal = req.signal ?? new AbortController().signal;
        const { output } = await adapter.invoke(entry.instanceId, req.payload, signal);
        entry.state = "warm";
        entry.lastUsedAt = now();
        const durationMs = Math.max(0, now() - tInvoke);
        const result: ServerlessInvokeResult = {
          ok: true,
          output,
          coldStart: coldStartFlag,
          durationMs,
          coldStartMs,
          instanceId: entry.instanceId,
          kind: adapter.kind,
          withinColdStartBudget: !coldStartFlag || coldStartMs <= coldStartBudgetMs,
        };
        idempotentResults.set(req.idempotencyKey, result);
        seenKeys.delete(req.idempotencyKey);
        if (meteringEnabled) {
          metering.push({
            workflowId: req.workflowId,
            nodeId: req.nodeId,
            idempotencyKey: req.idempotencyKey,
            durationMs,
            coldStart: coldStartFlag,
            at: new Date(now()).toISOString(),
          });
        }
        return result;
      } catch (err) {
        if (entry) {
          entry.state = "warm";
          entry.lastUsedAt = now();
        }
        seenKeys.delete(req.idempotencyKey);
        const durationMs = Math.max(0, now() - tInvoke);
        return {
          ok: false,
          coldStart: coldStartFlag,
          durationMs,
          coldStartMs,
          instanceId: entry?.instanceId ?? "",
          kind: adapter.kind,
          withinColdStartBudget: !coldStartFlag || coldStartMs <= coldStartBudgetMs,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async ensureWarm(count) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error("ensureWarm count must be a non-negative integer");
      }
      const target = Math.min(count, maxInstances);
      while ([...pool.values()].filter((e) => e.state === "warm" || e.state === "busy").length < target) {
        await coldStart();
      }
    },

    async scaleToZero() {
      const idle = [...pool.values()].filter((e) => e.state === "warm");
      for (const entry of idle) {
        await disposeEntry(entry);
      }
    },

    async tick() {
      const t = now();
      const idle = [...pool.values()].filter(
        (e) => e.state === "warm" && t - e.lastUsedAt >= idleTtlMs,
      );
      for (const entry of idle) {
        await disposeEntry(entry);
      }
    },

    snapshot() {
      let warmIdle = 0;
      let busy = 0;
      for (const e of pool.values()) {
        if (e.state === "warm") warmIdle += 1;
        if (e.state === "busy") busy += 1;
      }
      return {
        kind: adapter.kind,
        warmIdle,
        busy,
        totalInstances: pool.size,
        coldStartCount,
        coldStartBudgetMs,
        coldStartsOverBudget,
        meteringEnabled,
        meteringEventCount: metering.length,
      };
    },

    meteringEvents() {
      return metering.map((e) => ({ ...e }));
    },
  };
}
