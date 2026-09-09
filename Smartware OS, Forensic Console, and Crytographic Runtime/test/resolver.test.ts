import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, type NodeDefinition, type WorkflowDefinition } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";
import { createDependencyResolver } from "../src/dependencyResolver.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

function wf(nodes: Record<string, NodeDefinition>, entrypoints: string[]): WorkflowDefinition {
  return { id: "wf", version: "1.0.0", nodes, entrypoints };
}

function node(id: string, dependsOn: string[] = []): NodeDefinition {
  return { id, type: "task", dependsOn, config: {} };
}

describe("RFC-0002 resolver", () => {
  it("emits NODE_READY for entrypoints on init", () => {
    const def = wf({ a: node("a"), b: node("b", ["a"]) }, ["a"]);
    const compiled = compile(def, registry());
    assert.equal(compiled.ok, true);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    const events = resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    assert.equal(events[0]?.type, "NODE_READY");
    if (events[0]?.type === "NODE_READY") {
      assert.equal(events[0].nodeId, "a");
      assert.equal(events[0].attempt, 1);
    }
  });

  it("is idempotent on duplicate NODE_SUCCEEDED", () => {
    const def = wf({ a: node("a") }, ["a"]);
    const compiled = compile(def, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    const ready = resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    assert.equal(ready[0]?.type, "NODE_READY");
    if (ready[0]?.type !== "NODE_READY") {
      return;
    }
    const key = ready[0].idempotencyKey;
    resolver.handle({ type: "NODE_STARTED", nodeId: "a", executionId: key, startedAt: "t" });
    const first = resolver.handle({
      type: "NODE_SUCCEEDED",
      nodeId: "a",
      executionId: key,
      completedAt: "t2",
    });
    const second = resolver.handle({
      type: "NODE_SUCCEEDED",
      nodeId: "a",
      executionId: key,
      completedAt: "t2",
    });
    assert.ok(first.some((e) => e.type === "WORKFLOW_COMPLETED"));
    assert.equal(second.length, 0);
  });

  it("rejects idempotency mismatch with branch-only AMBIGUOUS", () => {
    const def = wf({ a: node("a"), b: node("b") }, ["a"]);
    const compiled = compile(def, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    resolver.init(compiled.graph, { failurePolicy: "CONTINUE", jitterSeed: 1 });
    const out = resolver.handle({
      type: "NODE_STARTED",
      nodeId: "a",
      executionId: "wrong",
      startedAt: "t",
    });
    assert.ok(out.some((e) => e.type === "RESOLVER_STATE_AMBIGUOUS"));
    const snap = resolver.snapshot();
    assert.notEqual(snap["b"]?.state, "SKIPPED");
  });

  it("HALT skips dependents on failure after retries exhausted", () => {
    const def = wf(
      {
        a: { ...node("a"), retryPolicy: { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1 } },
        b: node("b", ["a"]),
      },
      ["a"],
    );
    const compiled = compile(def, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    const ready = resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    if (ready[0]?.type !== "NODE_READY") {
      assert.fail("expected ready");
      return;
    }
    const key = ready[0].idempotencyKey;
    resolver.handle({ type: "NODE_STARTED", nodeId: "a", executionId: key, startedAt: "t" });
    resolver.handle({
      type: "NODE_FAILED",
      nodeId: "a",
      executionId: key,
      failedAt: "t2",
      error: "boom",
    });
    assert.equal(resolver.snapshot()["b"]?.state, "SKIPPED");
  });

  it("snapshot is a deep copy", () => {
    const def = wf({ a: node("a") }, ["a"]);
    const compiled = compile(def, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    const snap = resolver.snapshot();
    const rec = snap["a"];
    assert.ok(rec);
    rec.state = "FAILED";
    assert.notEqual(resolver.snapshot()["a"]?.state, "FAILED");
  });

  it("cancel is idempotent", () => {
    const def = wf({ a: node("a"), b: node("b", ["a"]) }, ["a"]);
    const compiled = compile(def, registry());
    assert.ok(compiled.ok);
    if (!compiled.ok) {
      return;
    }
    const resolver = createDependencyResolver();
    resolver.init(compiled.graph, { failurePolicy: "HALT", jitterSeed: 1 });
    const first = resolver.cancel();
    const second = resolver.cancel();
    assert.ok(first.some((e) => e.type === "WORKFLOW_FAILED"));
    assert.equal(second.length, 0);
  });
});
