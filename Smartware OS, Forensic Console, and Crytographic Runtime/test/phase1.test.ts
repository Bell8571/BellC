import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";
import { createDependencyResolver } from "../src/dependencyResolver.js";
import {
  createExecutionEngine,
  createExecutorRegistry,
  type BackPressureState,
} from "../src/executionEngine.js";
import { createDagVisualizer } from "../src/dagVisualizer.js";
import { runWorkflow } from "../src/runtime.js";
import { saveDurableState, loadDurableState } from "../src/durableStore.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTriggerListener } from "../src/eventTriggers.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

const linear = {
  id: "linear",
  version: "1.0.0",
  entrypoints: ["a"],
  nodes: {
    a: { id: "a", type: "task", dependsOn: [] as string[], config: {} },
    b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
  },
};

describe("RFC-0003 engine", () => {
  it("duplicate NODE_READY is a no-op", async () => {
    const compiled = compile(linear, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    const events = resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    const ready = events.find((e) => e.type === "NODE_READY");
    assert.equal(ready?.type, "NODE_READY");
    if (ready?.type !== "NODE_READY") {
      return;
    }
    const engine = createExecutionEngine();
    const exec = createExecutorRegistry();
    exec.register("task", {
      async execute() {
        return { output: { ok: true } };
      },
    });
    engine.init({ maxConcurrentNodes: 2, workflowId: "linear" }, exec);
    const first = engine.dispatch(ready);
    const second = engine.dispatch(ready);
    assert.ok(first === "OPEN" || first === "PRESSURED");
    assert.equal(second, first);
  });

  it("returns SATURATED when the dispatch queue is full", () => {
    const compiled = compile(linear, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const engine = createExecutionEngine();
    engine.init(
      { maxConcurrentNodes: 1, dispatchQueueDepth: 1, workflowId: "linear" },
      createExecutorRegistry(),
    );
    const dummy = {
      type: "NODE_READY" as const,
      nodeId: "a",
      node: compiled.ok ? compiled.graph.nodes["a"]! : ({} as never),
      idempotencyKey: "k1",
      attempt: 1,
      timeoutDeadline: new Date(Date.now() + 60_000).toISOString(),
    };
    engine.dispatch(dummy);
    const pressured: BackPressureState = engine.dispatch({ ...dummy, idempotencyKey: "k2", nodeId: "b" });
    assert.equal(pressured, "SATURATED");
  });
});

describe("RFC-0004 visualizer", () => {
  it("does not invent edges", () => {
    const compiled = compile(linear, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const vis = createDagVisualizer();
    vis.bind(compiled.graph, { liveRefreshMs: 200 });
    vis.applySnapshot({
      ghost: {
        nodeId: "ghost",
        state: "RUNNING",
        attempts: 1,
      },
    });
    const frame = vis.frame();
    assert.equal(frame.nodes["ghost"], undefined);
    assert.deepEqual(
      frame.edges.map((e) => `${e.sourceNodeId}->${e.targetNodeId}`).sort(),
      ["a->b"],
    );
  });
});

describe("Phase 1 runtime", () => {
  it("runs a linear workflow to COMPLETED", async () => {
    const result = await runWorkflow(linear, registry(), { jitterSeed: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.terminal, "COMPLETED");
    assert.equal(result.nodeStates["a"], "SUCCEEDED");
    assert.equal(result.nodeStates["b"], "SUCCEEDED");
  });

  it("persists durable resolver snapshots locally", () => {
    const compiled = compile(linear, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const path = join(tmpdir(), `sw-durable-${Date.now()}.json`);
    saveDurableState(path, {
      workflowId: "linear",
      runId: "r1",
      savedAt: new Date().toISOString(),
      graph: compiled.graph,
      config: { failurePolicy: "HALT", jitterSeed: 1 },
      nodes: {
        a: { nodeId: "a", state: "SUCCEEDED", attempts: 1 },
        b: { nodeId: "b", state: "PENDING", attempts: 0 },
      },
    });
    const loaded = loadDurableState(path);
    assert.equal(loaded.nodes["a"]?.state, "SUCCEEDED");
    assert.equal(loaded.graph.workflowId, "linear");
  });
});

describe("RFC-0005 triggers", () => {
  it("duplicate trigger idempotencyKey is a no-op", () => {
    let starts = 0;
    const listener = createTriggerListener({
      startWorkflow() {
        starts += 1;
        return [];
      },
      resumeNode() {
        return [];
      },
    });
    listener.start([
      {
        id: "t1",
        kind: "queue",
        channel: "in",
        enabled: true,
        action: { type: "START_WORKFLOW", workflowId: "linear" },
      },
    ]);
    const delivery = {
      triggerId: "t1",
      idempotencyKey: "same",
      receivedAt: new Date().toISOString(),
    };
    listener.handle(delivery);
    listener.handle(delivery);
    assert.equal(starts, 1);
    listener.stop();
  });
});
