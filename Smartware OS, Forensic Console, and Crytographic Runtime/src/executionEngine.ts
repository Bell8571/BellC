/**
 * RFC-0003 Parallel Execution Engine. Thin dispatcher. No retry logic.
 */

import type { ResolverInboundEvent, ResolverOutboundEvent } from "./dependencyResolver.js";

export interface NodeExecutionContext {
  node: import("./dagCompiler.js").ResolvedNode;
  attempt: number;
  idempotencyKey: string;
  timeoutDeadline: string;
  workflowId: string;
  signal: AbortSignal;
}

export interface NodeExecutionResult {
  output?: unknown;
}

export interface NodeExecutor {
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

export interface ResourceLimits {
  maxCpuPercent?: number;
  maxMemoryMb?: number;
}

export interface ExecutionEngineConfig {
  maxConcurrentNodes: number;
  dispatchQueueDepth?: number;
  globalResourceLimits?: ResourceLimits;
  perWorkflowResourceLimits?: ResourceLimits;
  workflowId: string;
  workerGraceMs?: number;
}

export type BackPressureState = "OPEN" | "PRESSURED" | "SATURATED";

export type ExecutionStreamEvent =
  | { type: "NODE_DISPATCHED"; nodeId: string; workerId: string; attempt: number; dispatchedAt: string }
  | {
      type: "NODE_COMPLETED";
      nodeId: string;
      workerId: string;
      durationMs: number;
      outcome: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
    }
  | { type: "WORKER_IDLE"; workerId: string }
  | { type: "BACK_PRESSURE_CHANGED"; state: BackPressureState; queueDepth: number };

export interface ExecutorRegistry {
  register(nodeType: string, executor: NodeExecutor): void;
  resolve(nodeType: string): NodeExecutor | undefined;
}

export interface EngineSnapshot {
  activeWorkers: number;
  idleWorkers: number;
  queueDepth: number;
  backPressureState: BackPressureState;
  inFlightNodes: { nodeId: string; workerId: string; startedAt: string }[];
  resourceUsage: { cpuPercent: number; memoryMb: number };
}

export interface ExecutionEngine {
  init(config: ExecutionEngineConfig, registry: ExecutorRegistry): void;
  dispatch(event: ResolverOutboundEvent & { type: "NODE_READY" }): BackPressureState;
  onResolverEvent(handler: (event: ResolverInboundEvent) => void): void;
  onStreamEvent(handler: (event: ExecutionStreamEvent) => void): void;
  cancelWorkflow(workflowId: string): Promise<void>;
  snapshot(): EngineSnapshot;
}

type QueueItem = ResolverOutboundEvent & { type: "NODE_READY" };

export function createExecutorRegistry(): ExecutorRegistry {
  const map = new Map<string, NodeExecutor>();
  return {
    register(nodeType, executor) {
      map.set(nodeType, executor);
    },
    resolve(nodeType) {
      return map.get(nodeType);
    },
  };
}

function pressure(depth: number, cap: number): BackPressureState {
  if (depth >= cap) {
    return "SATURATED";
  }
  if (depth > cap * 0.5) {
    return "PRESSURED";
  }
  return "OPEN";
}

export function createExecutionEngine(): ExecutionEngine {
  let config: ExecutionEngineConfig | undefined;
  let registry: ExecutorRegistry | undefined;
  let inited = false;
  const queue: QueueItem[] = [];
  const seenKeys = new Set<string>();
  const inFlight = new Map<string, { nodeId: string; workerId: string; startedAt: string; abort: AbortController }>();
  let active = 0;
  let resolverHandlers: Array<(event: ResolverInboundEvent) => void> = [];
  let streamHandlers: Array<(event: ExecutionStreamEvent) => void> = [];
  let lastPressure: BackPressureState = "OPEN";
  let memoryMb = 0;
  let cancelled = false;

  const emitResolver = (event: ResolverInboundEvent): void => {
    for (const h of resolverHandlers) {
      h(event);
    }
  };
  const emitStream = (event: ExecutionStreamEvent): void => {
    for (const h of streamHandlers) {
      h(event);
    }
  };

  const cap = (): number => {
    const n = config?.maxConcurrentNodes ?? 8;
    return config?.dispatchQueueDepth ?? n * 2;
  };

  const emitPressure = (): BackPressureState => {
    const state = pressure(queue.length, cap());
    if (state !== lastPressure) {
      lastPressure = state;
      emitStream({ type: "BACK_PRESSURE_CHANGED", state, queueDepth: queue.length });
    }
    return state;
  };

  const pump = (): void => {
    if (!config || !registry || cancelled) {
      return;
    }
    while (active < config.maxConcurrentNodes && queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        break;
      }
      emitPressure();
      active += 1;
      const workerId = `w${active}-${item.nodeId}`;
      void runWorker(workerId, item).finally(() => {
        active -= 1;
        emitStream({ type: "WORKER_IDLE", workerId });
        pump();
      });
    }
  };

  const runWorker = async (workerId: string, item: QueueItem): Promise<void> => {
    if (!config || !registry) {
      return;
    }
    const abort = new AbortController();
    const startedAt = new Date().toISOString();
    inFlight.set(item.idempotencyKey, {
      nodeId: item.nodeId,
      workerId,
      startedAt,
      abort,
    });
    emitStream({
      type: "NODE_DISPATCHED",
      nodeId: item.nodeId,
      workerId,
      attempt: item.attempt,
      dispatchedAt: startedAt,
    });
    emitResolver({
      type: "NODE_STARTED",
      nodeId: item.nodeId,
      executionId: item.idempotencyKey,
      startedAt,
    });

    const executor = registry.resolve(item.node.type);
    const t0 = Date.now();
    const deadline = Date.parse(item.timeoutDeadline);
    const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : item.node.timeout;
    const grace = config.workerGraceMs ?? 5_000;

    if (!executor) {
      emitResolver({
        type: "NODE_FAILED",
        nodeId: item.nodeId,
        executionId: item.idempotencyKey,
        failedAt: new Date().toISOString(),
        error: "UNKNOWN_EXECUTOR",
      });
      emitStream({
        type: "NODE_COMPLETED",
        nodeId: item.nodeId,
        workerId,
        durationMs: Date.now() - t0,
        outcome: "FAILED",
      });
      inFlight.delete(item.idempotencyKey);
      return;
    }

    const limits = config.perWorkflowResourceLimits ?? config.globalResourceLimits;
    if (limits?.maxMemoryMb !== undefined && memoryMb > limits.maxMemoryMb) {
      emitResolver({
        type: "NODE_FAILED",
        nodeId: item.nodeId,
        executionId: item.idempotencyKey,
        failedAt: new Date().toISOString(),
        error: "RESOURCE_LIMIT_EXCEEDED",
      });
      emitStream({
        type: "NODE_COMPLETED",
        nodeId: item.nodeId,
        workerId,
        durationMs: Date.now() - t0,
        outcome: "FAILED",
      });
      inFlight.delete(item.idempotencyKey);
      return;
    }

    let outcome: "SUCCEEDED" | "FAILED" | "TIMED_OUT" = "FAILED";
    let settled = false;
    const timer = setTimeout(() => {
      abort.abort();
      if (!settled) {
        settled = true;
        outcome = "TIMED_OUT";
        emitResolver({
          type: "NODE_TIMED_OUT",
          nodeId: item.nodeId,
          executionId: item.idempotencyKey,
          timedOutAt: new Date().toISOString(),
        });
      }
    }, remaining);

    try {
      const result = await executor.execute({
        node: item.node,
        attempt: item.attempt,
        idempotencyKey: item.idempotencyKey,
        timeoutDeadline: item.timeoutDeadline,
        workflowId: config.workflowId,
        signal: abort.signal,
      });
      if (abort.signal.aborted) {
        throw new Error("aborted");
      }
      if (!settled) {
        settled = true;
        outcome = "SUCCEEDED";
        const approx = JSON.stringify(result.output ?? {}).length / (1024 * 1024);
        memoryMb += approx;
        emitResolver({
          type: "NODE_SUCCEEDED",
          nodeId: item.nodeId,
          executionId: item.idempotencyKey,
          completedAt: new Date().toISOString(),
          output: result.output,
        });
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        const message = err instanceof Error ? err.message : "executor failed";
        if (abort.signal.aborted) {
          outcome = "TIMED_OUT";
          emitResolver({
            type: "NODE_TIMED_OUT",
            nodeId: item.nodeId,
            executionId: item.idempotencyKey,
            timedOutAt: new Date().toISOString(),
          });
        } else {
          outcome = "FAILED";
          emitResolver({
            type: "NODE_FAILED",
            nodeId: item.nodeId,
            executionId: item.idempotencyKey,
            failedAt: new Date().toISOString(),
            error: message,
          });
        }
      }
    } finally {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        outcome = "FAILED";
        emitResolver({
          type: "NODE_FAILED",
          nodeId: item.nodeId,
          executionId: item.idempotencyKey,
          failedAt: new Date().toISOString(),
          error: "ambiguous completion",
        });
      }
      const leftover = remaining + grace;
      void leftover;
      emitStream({
        type: "NODE_COMPLETED",
        nodeId: item.nodeId,
        workerId,
        durationMs: Date.now() - t0,
        outcome,
      });
      inFlight.delete(item.idempotencyKey);
    }
  };

  return {
    init(cfg, reg): void {
      if (inited) {
        return;
      }
      config = {
        maxConcurrentNodes: cfg.maxConcurrentNodes || 8,
        dispatchQueueDepth: cfg.dispatchQueueDepth,
        globalResourceLimits: cfg.globalResourceLimits,
        perWorkflowResourceLimits: cfg.perWorkflowResourceLimits,
        workflowId: cfg.workflowId,
        workerGraceMs: cfg.workerGraceMs ?? 5_000,
      };
      registry = reg;
      inited = true;
    },

    dispatch(event): BackPressureState {
      if (!inited || !config) {
        throw new Error("ENGINE_NOT_INITIALISED");
      }
      if (seenKeys.has(event.idempotencyKey)) {
        return lastPressure;
      }
      if (queue.length >= cap()) {
        return emitPressure();
      }
      seenKeys.add(event.idempotencyKey);
      queue.push(event);
      const state = emitPressure();
      queueMicrotask(() => pump());
      return state;
    },

    onResolverEvent(handler): void {
      resolverHandlers.push(handler);
    },

    onStreamEvent(handler): void {
      streamHandlers.push(handler);
    },

    async cancelWorkflow(): Promise<void> {
      cancelled = true;
      queue.length = 0;
      for (const item of inFlight.values()) {
        item.abort.abort();
      }
      const start = Date.now();
      while (inFlight.size > 0 && Date.now() - start < (config?.workerGraceMs ?? 5_000) + 50) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },

    snapshot(): EngineSnapshot {
      const n = config?.maxConcurrentNodes ?? 8;
      return {
        activeWorkers: active,
        idleWorkers: Math.max(0, n - active),
        queueDepth: queue.length,
        backPressureState: lastPressure,
        inFlightNodes: [...inFlight.values()].map(({ nodeId, workerId, startedAt }) => ({
          nodeId,
          workerId,
          startedAt,
        })),
        resourceUsage: {
          cpuPercent: n === 0 ? 0 : (active / n) * 100,
          memoryMb,
        },
      };
    },
  };
}

export const DEFAULT_MAX_CONCURRENT_NODES = 8;
export const DEFAULT_WORKER_GRACE_MS = 5_000;
