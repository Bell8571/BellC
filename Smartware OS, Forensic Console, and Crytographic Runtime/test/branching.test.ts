import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePredicate } from "../src/predicates.js";
import { compile, type NodeDefinition, type WorkflowDefinition } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";
import { createDependencyResolver } from "../src/dependencyResolver.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

describe("RFC-0005 predicates", () => {
  it("eq / exists / missing path", () => {
    const ok = evaluatePredicate({ op: "eq", path: "x", value: 1 }, { x: 1 });
    assert.deepEqual(ok, { ok: true, value: true });
    const exists = evaluatePredicate({ op: "exists", path: "x" }, { x: 0 });
    assert.deepEqual(exists, { ok: true, value: true });
    const missing = evaluatePredicate({ op: "eq", path: "y", value: 1 }, { x: 1 });
    assert.equal(missing.ok, false);
  });

  it("does not use eval", () => {
    const src = evaluatePredicate.toString();
    assert.equal(src.includes("eval("), false);
    assert.equal(src.includes("Function("), false);
  });
});

describe("RFC-0005 branching compile + resolve", () => {
  it("rejects unbounded loops", () => {
    const def: WorkflowDefinition = {
      id: "loop",
      version: "1.0.0",
      entrypoints: ["a"],
      nodes: {
        a: {
          id: "a",
          type: "task",
          dependsOn: [],
          config: {},
          control: { kind: "loop", predicate: { op: "eq", path: "ok", value: true }, body: ["b"], maxIterations: 0 },
        },
        b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
      },
    };
    const result = compile(def, registry());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => e.code === "UNBOUNDED_LOOP"));
    }
  });

  it("READY taken if-arm and SKIPPED else-arm", () => {
    const nodes: Record<string, NodeDefinition> = {
      a: {
        id: "a",
        type: "task",
        dependsOn: [],
        config: {},
        control: {
          kind: "if",
          predicate: { op: "eq", path: "ok", value: true },
          then: ["b"],
          else: ["c"],
        },
      },
      b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
      c: { id: "c", type: "task", dependsOn: ["a"], config: {} },
    };
    const compiled = compile({ id: "br", version: "1.0.0", nodes, entrypoints: ["a"] }, registry());
    assert.equal(compiled.ok, true);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    const init = resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    const ready = init.find((e) => e.type === "NODE_READY");
    assert.equal(ready?.type, "NODE_READY");
    if (ready?.type !== "NODE_READY") {
      return;
    }
    resolver.handle({ type: "NODE_STARTED", nodeId: "a", executionId: ready.idempotencyKey, startedAt: "t" });
    const out = resolver.handle({
      type: "NODE_SUCCEEDED",
      nodeId: "a",
      executionId: ready.idempotencyKey,
      completedAt: "t2",
      output: { ok: true },
    });
    assert.ok(out.some((e) => e.type === "NODE_READY" && e.nodeId === "b"));
    assert.equal(resolver.snapshot()["c"]?.state, "SKIPPED");
  });
});
