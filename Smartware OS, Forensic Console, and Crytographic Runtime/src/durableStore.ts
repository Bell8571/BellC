/**
 * RFC-0007 durable resolver state — local JSON file only. Opt-in.
 * Crash restore. No network.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ResolvedExecutionGraph } from "./dagCompiler.js";
import type {
  DependencyResolver,
  ResolverConfig,
  ResolverInboundEvent,
  ResolverNodeRecord,
  ResolverOutboundEvent,
} from "./dependencyResolver.js";

export interface DurableResolverState {
  workflowId: string;
  runId: string;
  savedAt: string;
  graph: ResolvedExecutionGraph;
  config: ResolverConfig;
  nodes: Record<string, ResolverNodeRecord>;
}

export function saveDurableState(path: string, state: DurableResolverState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`, "utf8");
}

export function loadDurableState(path: string): DurableResolverState {
  return JSON.parse(readFileSync(path, "utf8")) as DurableResolverState;
}

export function persistAfter(
  resolver: DependencyResolver,
  path: string,
  graph: ResolvedExecutionGraph,
  config: ResolverConfig,
  runId: string,
): void {
  const snap = resolver.snapshot();
  saveDurableState(path, {
    workflowId: graph.workflowId,
    runId,
    savedAt: new Date().toISOString(),
    graph,
    config,
    nodes: snap,
  });
}

export function wrapDurable(
  resolver: DependencyResolver,
  path: string,
  graph: ResolvedExecutionGraph,
  config: ResolverConfig,
  runId: string,
): DependencyResolver {
  const persist = (): void => persistAfter(resolver, path, graph, config, runId);
  return {
    init(g, cfg) {
      const out = resolver.init(g, cfg);
      persist();
      return out;
    },
    handle(event: ResolverInboundEvent) {
      const out = resolver.handle(event);
      persist();
      return out;
    },
    cancel() {
      const out = resolver.cancel();
      persist();
      return out;
    },
    snapshot: () => resolver.snapshot(),
    resumeNode(nodeId) {
      const out = resolver.resumeNode(nodeId);
      persist();
      return out;
    },
    onScheduled(handler) {
      resolver.onScheduled((events: ResolverOutboundEvent[]) => {
        persist();
        handler(events);
      });
    },
    hydrate(nodes) {
      resolver.hydrate(nodes);
      persist();
    },
  };
}
