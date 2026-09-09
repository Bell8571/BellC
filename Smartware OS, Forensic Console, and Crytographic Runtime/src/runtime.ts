/**
 * Phase 1 run loop: compile → resolver ↔ engine. Local only.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { compile, type ResolvedExecutionGraph, type WorkflowDefinition } from "./dagCompiler.js";
import type { NodeTypeRegistry } from "./pluginApi.js";
import {
  createDependencyResolver,
  type DependencyResolver,
  type FailurePolicy,
  type ResolverConfig,
  type ResolverOutboundEvent,
} from "./dependencyResolver.js";
import {
  createExecutionEngine,
  createExecutorRegistry,
  DEFAULT_MAX_CONCURRENT_NODES,
  type ExecutionEngine,
  type NodeExecutor,
} from "./executionEngine.js";
import { createDagVisualizer, type TraceRecord } from "./dagVisualizer.js";
import { wrapDurable } from "./durableStore.js";
import { randomUUID } from "node:crypto";

export interface RunOptions {
  failurePolicy?: FailurePolicy;
  jitterSeed?: number;
  maxConcurrentNodes?: number;
  traceLogPath?: string;
  durablePath?: string;
  waitForTrigger?: string[];
  maxGlobalTimeout?: number;
}

export interface RunResult {
  ok: boolean;
  terminal: "COMPLETED" | "FAILED" | "CANCELLED";
  nodeStates: Record<string, string>;
  graph: ResolvedExecutionGraph;
}

function writeTrace(path: string | undefined, record: TraceRecord): void {
  if (!path) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function createTaskExecutor(): NodeExecutor {
  return {
    async execute(ctx) {
      if (ctx.signal.aborted) {
        throw new Error("aborted before work");
      }
      return { output: { ...(ctx.node.config as Record<string, unknown>), ok: true } };
    },
  };
}

export async function runWorkflow(
  definition: WorkflowDefinition,
  typeRegistry: NodeTypeRegistry,
  options: RunOptions = {},
): Promise<RunResult> {
  const compiled = compile(definition, typeRegistry);
  if (!compiled.ok) {
    throw new Error(`compile failed: ${compiled.errors.map((e) => e.code).join(",")}`);
  }
  const graph = compiled.graph;
  const runId = randomUUID();
  const cfg: ResolverConfig = {
    failurePolicy: options.failurePolicy ?? "HALT",
    jitterSeed: options.jitterSeed,
    waitForTrigger: options.waitForTrigger,
    maxGlobalTimeout: options.maxGlobalTimeout,
  };

  let resolver: DependencyResolver = createDependencyResolver();
  if (options.durablePath) {
    resolver = wrapDurable(resolver, options.durablePath, graph, cfg, runId);
  }

  const executors = createExecutorRegistry();
  executors.register("task", createTaskExecutor());

  const engine: ExecutionEngine = createExecutionEngine();
  engine.init(
    {
      maxConcurrentNodes: options.maxConcurrentNodes ?? DEFAULT_MAX_CONCURRENT_NODES,
      workflowId: graph.workflowId,
    },
    executors,
  );

  const visualizer = createDagVisualizer();
  visualizer.bind(graph, { liveRefreshMs: 200, traceLogPath: options.traceLogPath });
  writeTrace(options.traceLogPath, {
    kind: "header",
    header: {
      workflowId: graph.workflowId,
      runId,
      compilerVersion: graph.compilerVersion,
      recordedAt: new Date().toISOString(),
      graph,
    },
  });

  let settle: (value: RunResult) => void;
  const done = new Promise<RunResult>((resolve) => {
    settle = resolve;
  });

  const feed = (events: ResolverOutboundEvent[]): void => {
    for (const ev of events) {
      if (ev.type === "NODE_READY") {
        engine.dispatch(ev);
      } else if (ev.type === "WORKFLOW_COMPLETED") {
        writeTrace(options.traceLogPath, {
          kind: "end",
          capturedAt: new Date().toISOString(),
          terminal: "COMPLETED",
        });
        settle({
          ok: true,
          terminal: "COMPLETED",
          nodeStates: ev.nodeStates,
          graph,
        });
      } else if (ev.type === "WORKFLOW_FAILED") {
        const cancelled = ev.failedNodes.length > 0 && Object.values(ev.nodeStates).every((s) => s === "CANCELLED" || s === "SKIPPED");
        writeTrace(options.traceLogPath, {
          kind: "end",
          capturedAt: new Date().toISOString(),
          terminal: cancelled ? "CANCELLED" : "FAILED",
        });
        settle({
          ok: false,
          terminal: cancelled ? "CANCELLED" : "FAILED",
          nodeStates: ev.nodeStates,
          graph,
        });
      }
    }
    visualizer.applySnapshot(resolver.snapshot());
    writeTrace(options.traceLogPath, {
      kind: "snapshot",
      capturedAt: new Date().toISOString(),
      nodes: resolver.snapshot(),
    });
  };

  resolver.onScheduled(feed);
  engine.onResolverEvent((event) => {
    feed(resolver.handle(event));
  });
  engine.onStreamEvent((event) => {
    visualizer.applyStreamEvent(event);
    writeTrace(options.traceLogPath, {
      kind: "stream",
      event,
      capturedAt: new Date().toISOString(),
    });
  });

  feed(resolver.init(graph, cfg));
  return done;
}
