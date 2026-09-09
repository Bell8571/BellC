import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";
import { createDistributedScheduler } from "../src/distributedScheduler.js";
import { createFailoverController } from "../src/failover.js";
import { createTenancyController, RBAC_SCHEMA_VERSION } from "../src/tenancy.js";
import type { ClusterMember } from "../src/topologyManager.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

function member(nodeId: string, state: ClusterMember["state"] = "ALIVE"): ClusterMember {
  return {
    nodeId,
    address: `inproc://${nodeId}`,
    state,
    joinedAt: "t0",
    lastHeartbeatAt: "t0",
    metadata: {},
  };
}

describe("RFC-0012 tenancy / RBAC", () => {
  it("exposes RBAC schema version 1", () => {
    assert.equal(createTenancyController().rbacSchemaVersion(), RBAC_SCHEMA_VERSION);
  });

  it("denies by default and grants operator workflow:run", () => {
    const t = createTenancyController();
    t.createNamespace("acme", { maxConcurrentWorkflows: 2, maxPlacedNodes: 10 });
    assert.equal(t.authorize("u1", "acme", "workflow:run").ok, false);
    t.bindRole({ principalId: "u1", namespaceId: "acme", role: "operator" });
    assert.equal(t.authorize("u1", "acme", "workflow:run").ok, true);
    assert.equal(t.authorize("u1", "acme", "namespace:manage").ok, false);
  });

  it("enforces workflow quotas fail-closed", () => {
    const t = createTenancyController();
    t.createNamespace("ns", { maxConcurrentWorkflows: 1, maxPlacedNodes: 5 });
    assert.equal(t.beginWorkflow("ns", "w1", 2).ok, true);
    const second = t.beginWorkflow("ns", "w2", 1);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "QUOTA_EXCEEDED");
    t.endWorkflow("ns", "w1");
    assert.equal(t.beginWorkflow("ns", "w2", 1).ok, true);
  });

  it("enforces maxPlacedNodes", () => {
    const t = createTenancyController();
    t.createNamespace("ns", { maxConcurrentWorkflows: 5, maxPlacedNodes: 3 });
    assert.equal(t.beginWorkflow("ns", "w1", 2).ok, true);
    const over = t.beginWorkflow("ns", "w2", 2);
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.code, "QUOTA_EXCEEDED");
  });
});

describe("RFC-0012 failover", () => {
  it("reassigns placements from DEAD hosts and checkpoints", () => {
    const compiled = compile(
      {
        id: "wf-ft",
        version: "1",
        entrypoints: ["a"],
        nodes: {
          a: { id: "a", type: "task", dependsOn: [], config: {} },
          b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
        },
      },
      registry(),
    );
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    const sched = createDistributedScheduler();
    const initial = sched.place(compiled.graph, [member("n1"), member("n2"), member("n3")], { now: "t0" });
    assert.equal(initial.ok, true);
    if (!initial.ok) return;

    // Force both on n1 for a clear failover case.
    const plan = {
      ...initial.plan,
      placements: {
        a: { ...initial.plan.placements["a"]!, assignedNodeId: "n1" },
        b: { ...initial.plan.placements["b"]!, assignedNodeId: "n1" },
      },
    };

    const ft = createFailoverController({ scheduler: sched });
    const result = ft.failover({
      graph: compiled.graph,
      plan,
      members: [member("n1", "DEAD"), member("n2", "ALIVE"), member("n3", "ALIVE")],
      namespaceId: "acme",
      completedNodeIds: ["a"],
      clusterSize: 3,
      now: "t1",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // a completed — placement left as-is; b must move off n1
    assert.equal(result.plan.placements["a"]!.assignedNodeId, "n1");
    assert.notEqual(result.plan.placements["b"]!.assignedNodeId, "n1");
    assert.equal(result.reassignments.length, 1);
    assert.equal(result.reassignments[0]!.dagNodeId, "b");
    assert.equal(ft.loadCheckpoint("wf-ft")?.namespaceId, "acme");
  });

  it("refuse_writes on split-brain (alive < quorum)", () => {
    const compiled = compile(
      {
        id: "wf-sb",
        version: "1",
        entrypoints: ["a"],
        nodes: { a: { id: "a", type: "task", dependsOn: [], config: {} } },
      },
      registry(),
    );
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const sched = createDistributedScheduler();
    const placed = sched.place(compiled.graph, [member("n1"), member("n2"), member("n3")]);
    assert.equal(placed.ok, true);
    if (!placed.ok) return;

    const ft = createFailoverController({ splitBrainPolicy: "refuse_writes", scheduler: sched });
    const r = ft.failover({
      graph: compiled.graph,
      plan: placed.plan,
      members: [member("n1", "DEAD"), member("n2", "DEAD"), member("n3", "ALIVE")],
      namespaceId: "ns",
      clusterSize: 3,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "SPLIT_BRAIN");
  });
});
