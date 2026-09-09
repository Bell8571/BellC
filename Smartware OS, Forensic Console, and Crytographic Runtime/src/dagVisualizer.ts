/**
 * RFC-0004 DAG Visualizer — consumer only. CLI sidecar. Local traces.
 */

import type { ResolvedExecutionGraph } from "./dagCompiler.js";
import type { NodeState, ResolverNodeRecord } from "./dependencyResolver.js";
import type { EngineSnapshot, ExecutionStreamEvent } from "./executionEngine.js";

export interface VisualizerNodeView {
  nodeId: string;
  type: string;
  batchIndex: number;
  dependsOn: string[];
  dependents: string[];
  state: NodeState;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface VisualizerEdgeView {
  sourceNodeId: string;
  targetNodeId: string;
}

export interface VisualizerFrame {
  workflowId: string;
  compiledAt: string;
  capturedAt: string;
  nodes: Record<string, VisualizerNodeView>;
  edges: VisualizerEdgeView[];
  batches: string[][];
  engine?: EngineSnapshot;
}

export interface TraceHeader {
  workflowId: string;
  runId: string;
  compilerVersion: string;
  recordedAt: string;
  graph: ResolvedExecutionGraph;
}

export type TraceRecord =
  | { kind: "header"; header: TraceHeader }
  | { kind: "snapshot"; capturedAt: string; nodes: Record<string, ResolverNodeRecord> }
  | { kind: "stream"; event: ExecutionStreamEvent; capturedAt: string }
  | { kind: "end"; capturedAt: string; terminal: "COMPLETED" | "FAILED" | "CANCELLED" };

export interface VisualizerConfig {
  liveRefreshMs: number;
  traceLogPath?: string;
  maxTraceBytes?: number;
}

export interface DagVisualizer {
  bind(graph: ResolvedExecutionGraph, config: VisualizerConfig): void;
  applySnapshot(nodes: Record<string, ResolverNodeRecord>): void;
  applyStreamEvent(event: ExecutionStreamEvent): void;
  applyEngineSnapshot(snapshot: EngineSnapshot): void;
  frame(): VisualizerFrame;
  replay(records: TraceRecord[]): VisualizerFrame[];
}

export function createDagVisualizer(): DagVisualizer {
  let graph: ResolvedExecutionGraph | undefined;
  let nodes: Record<string, VisualizerNodeView> = {};
  let engine: EngineSnapshot | undefined;
  let dropped = 0;

  const rebuildFromGraph = (g: ResolvedExecutionGraph): Record<string, VisualizerNodeView> => {
    const views: Record<string, VisualizerNodeView> = {};
    for (const [id, n] of Object.entries(g.nodes)) {
      views[id] = {
        nodeId: id,
        type: n.type,
        batchIndex: n.batchIndex,
        dependsOn: [...n.dependsOn],
        dependents: [...n.dependents],
        state: "PENDING",
        attempts: 0,
      };
    }
    return views;
  };

  const edgesOf = (g: ResolvedExecutionGraph): VisualizerEdgeView[] => {
    const edges: VisualizerEdgeView[] = [];
    for (const n of Object.values(g.nodes)) {
      for (const dep of n.dependsOn) {
        edges.push({ sourceNodeId: dep, targetNodeId: n.id });
      }
    }
    return edges;
  };

  return {
    bind(g): void {
      graph = g;
      nodes = rebuildFromGraph(g);
      engine = undefined;
      dropped = 0;
    },

    applySnapshot(snap): void {
      void dropped;
      for (const [id, rec] of Object.entries(snap)) {
        const view = nodes[id];
        if (!view) {
          dropped += 1;
          continue;
        }
        view.state = rec.state;
        view.attempts = rec.attempts;
        view.lastError = rec.lastError;
        view.startedAt = rec.startedAt;
        view.completedAt = rec.completedAt;
      }
    },

    applyStreamEvent(event): void {
      if (event.type === "WORKER_IDLE" || event.type === "BACK_PRESSURE_CHANGED") {
        return;
      }
      if (event.type === "NODE_DISPATCHED" || event.type === "NODE_COMPLETED") {
        if (!nodes[event.nodeId]) {
          dropped += 1;
        }
      }
    },

    applyEngineSnapshot(snapshot): void {
      engine = snapshot;
    },

    frame(): VisualizerFrame {
      if (!graph) {
        return {
          workflowId: "",
          compiledAt: "",
          capturedAt: new Date().toISOString(),
          nodes: {},
          edges: [],
          batches: [],
        };
      }
      return {
        workflowId: graph.workflowId,
        compiledAt: graph.compiledAt,
        capturedAt: new Date().toISOString(),
        nodes: { ...nodes },
        edges: edgesOf(graph),
        batches: graph.executionOrder.map((b) => [...b]),
        engine,
      };
    },

    replay(records): VisualizerFrame[] {
      const frames: VisualizerFrame[] = [];
      for (const rec of records) {
        if (rec.kind === "header") {
          this.bind(rec.header.graph, { liveRefreshMs: 200 });
        } else if (rec.kind === "snapshot") {
          this.applySnapshot(rec.nodes);
          frames.push(this.frame());
        } else if (rec.kind === "stream") {
          this.applyStreamEvent(rec.event);
        }
      }
      return frames;
    },
  };
}

export function renderFrameText(frame: VisualizerFrame): string {
  const lines: string[] = [
    `workflow ${frame.workflowId}  captured ${frame.capturedAt}`,
    `batches: ${frame.batches.map((b) => `[${b.join(", ")}]`).join(" → ")}`,
  ];
  for (const id of Object.keys(frame.nodes).sort()) {
    const n = frame.nodes[id];
    if (!n) {
      continue;
    }
    const err = n.lastError ? ` error=${n.lastError}` : "";
    lines.push(`  ${n.nodeId}  ${n.state}  type=${n.type}  batch=${n.batchIndex}  attempts=${n.attempts}${err}`);
  }
  return `${lines.join("\n")}\n`;
}

export const DEFAULT_LIVE_REFRESH_MS = 200;
export const DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024;
