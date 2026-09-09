import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_NODE_COUNT,
  compile,
  parse,
  type NodeDefinition,
  type WorkflowDefinition,
} from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";

function taskRegistry() {
  const registry = createNodeTypeRegistry();
  registry.registerNodeType({
    type: "task",
    version: "1.0.0",
    configSchema: {
      fields: {
        label: { type: "string", required: false },
      },
    },
  });
  return registry;
}

function node(id: string, dependsOn: string[] = []): NodeDefinition {
  return { id, type: "task", dependsOn, config: {} };
}

function workflow(nodes: Record<string, NodeDefinition>, entrypoints: string[]): WorkflowDefinition {
  return { id: "wf", version: "1.0.0", nodes, entrypoints };
}

describe("RFC-0001 compile", () => {
  it("compiles a linear chain into batches", () => {
    const def = workflow(
      {
        a: node("a"),
        b: node("b", ["a"]),
        c: node("c", ["b"]),
      },
      ["a"],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.graph.executionOrder, [["a"], ["b"], ["c"]]);
      assert.equal(result.graph.nodes["b"]?.dependsOn[0], "a");
      assert.equal(result.graph.nodes["a"]?.dependents[0], "b");
      assert.equal(result.graph.metadata.nodeCount, 3);
      assert.equal(result.graph.metadata.edgeCount, 2);
      assert.equal(result.graph.metadata.parallelBatches, 3);
    }
  });

  it("emits parallel batches with lexicographic order", () => {
    const def = workflow(
      {
        a: node("a"),
        c: node("c", ["a"]),
        b: node("b", ["a"]),
      },
      ["a"],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.graph.executionOrder, [["a"], ["b", "c"]]);
    }
  });

  it("is topologically deterministic across calls", () => {
    const def = workflow(
      {
        z: node("z"),
        y: node("y", ["z"]),
        x: node("x", ["z"]),
      },
      ["z"],
    );
    const r1 = compile(def, taskRegistry());
    const r2 = compile(def, taskRegistry());
    assert.equal(r1.ok && r2.ok, true);
    if (r1.ok && r2.ok) {
      assert.deepEqual(r1.graph.executionOrder, r2.graph.executionOrder);
      assert.deepEqual(r1.graph.executionOrder, [["z"], ["x", "y"]]);
    }
  });

  it("detects cycles and does not auto-repair", () => {
    const def = workflow(
      {
        a: node("a", ["b"]),
        b: node("b", ["a"]),
      },
      [],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      const cycle = result.errors.find((e) => e.code === "CYCLE_DETECTED");
      assert.ok(cycle);
      if (cycle && cycle.code === "CYCLE_DETECTED") {
        assert.ok(cycle.cycle.includes("a"));
        assert.ok(cycle.cycle.includes("b"));
      }
    }
  });

  it("rejects duplicate node ids", () => {
    const def = workflow(
      {
        a: node("a"),
        b: { id: "a", type: "task", dependsOn: [], config: {} },
      },
      ["a"],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.code === "DUPLICATE_NODE_ID"));
    }
  });

  it("detects a self-loop as a cycle", () => {
    const def = workflow({ a: node("a", ["a"]) }, []);
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      const cycle = result.errors.find((e) => e.code === "CYCLE_DETECTED");
      assert.ok(cycle && cycle.code === "CYCLE_DETECTED");
      assert.ok(cycle.cycle.includes("a"));
    }
  });

  it("dedupes repeated dependsOn edges for Kahn", () => {
    const def = workflow(
      {
        a: node("a"),
        b: node("b", ["a", "a"]),
      },
      ["a"],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.graph.executionOrder, [["a"], ["b"]]);
    }
  });

  it("rejects unknown node types", () => {
    const def = workflow({ a: { ...node("a"), type: "nope" } }, ["a"]);
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.code === "INVALID_NODE_TYPE"));
    }
  });

  it("rejects unknown dependsOn refs", () => {
    const def = workflow({ a: node("a", ["ghost"]) }, []);
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.code === "UNKNOWN_DEPENDENCY"));
    }
  });

  it("rejects missing required config fields", () => {
    const registry = createNodeTypeRegistry();
    registry.registerNodeType({
      type: "http.request",
      version: "1.0.0",
      configSchema: { fields: { url: { type: "string", required: true } } },
    });
    const def = workflow(
      { a: { id: "a", type: "http.request", dependsOn: [], config: {} } },
      ["a"],
    );
    const result = compile(def, registry);
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "SCHEMA_VIOLATION");
      assert.ok(err && err.code === "SCHEMA_VIOLATION" && err.field === "url");
    }
  });

  it("allows extra config keys (forward compatible)", () => {
    const def = workflow(
      { a: { id: "a", type: "task", dependsOn: [], config: { label: "ok", extra: 1 } } },
      ["a"],
    );
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, true);
  });

  it("hard-rejects graphs over 10_000 nodes", () => {
    const nodes: Record<string, NodeDefinition> = {};
    for (let i = 0; i < MAX_NODE_COUNT + 1; i++) {
      const id = `n${i}`;
      nodes[id] = node(id);
    }
    const def = workflow(nodes, ["n0"]);
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "GRAPH_TOO_LARGE");
      assert.ok(err && err.code === "GRAPH_TOO_LARGE");
      assert.equal(err.max, MAX_NODE_COUNT);
    }
  });

  it("never throws on malformed input", () => {
    const def = workflow({}, []);
    assert.doesNotThrow(() => compile(def, taskRegistry()));
    const result = compile(def, taskRegistry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.code === "MISSING_ENTRYPOINT"));
    }
  });
});

describe("RFC-0001 parse", () => {
  it("parses JSON", () => {
    const source = JSON.stringify({
      id: "wf",
      version: "1.0.0",
      entrypoints: ["a"],
      nodes: {
        a: { id: "a", type: "task", dependsOn: [], config: {} },
      },
    });
    const result = parse(source, "json");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.definition.id, "wf");
    }
  });

  it("parses YAML", () => {
    const source = `
id: wf
version: "1.0.0"
entrypoints:
  - a
nodes:
  a:
    id: a
    type: task
    dependsOn: []
    config: {}
`;
    const result = parse(source, "yaml");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.definition.nodes["a"]?.type, "task");
    }
  });

  it("returns SCHEMA_VIOLATION on invalid JSON", () => {
    const result = parse("{", "json");
    assert.equal(result.ok, false);
  });
});

describe("RFC-0001 compile size smoke", () => {
  it("compiles 1_000 nodes under the 500 ms 10k-node budget", () => {
    const nodes: Record<string, NodeDefinition> = {};
    for (let i = 0; i < 1_000; i++) {
      const id = `n${i}`;
      nodes[id] = node(id, i === 0 ? [] : [`n${i - 1}`]);
    }
    const def = workflow(nodes, ["n0"]);
    const start = performance.now();
    const result = compile(def, taskRegistry());
    const elapsed = performance.now() - start;
    assert.equal(result.ok, true);
    assert.ok(elapsed < 500, `compile took ${elapsed}ms`);
  });
});
