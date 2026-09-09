import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compile, type ResolvedExecutionGraph } from "../src/dagCompiler.js";
import { createNodeTypeRegistry } from "../src/pluginApi.js";
import { createDistributedScheduler } from "../src/distributedScheduler.js";
import type { ClusterMember } from "../src/topologyManager.js";

function registry() {
  const r = createNodeTypeRegistry();
  r.registerNodeType({ type: "task", version: "1.0.0", configSchema: { fields: {} } });
  return r;
}

function linearGraph(): ResolvedExecutionGraph {
  const result = compile(
    {
      id: "wf-place",
      version: "1",
      entrypoints: ["a"],
      nodes: {
        a: { id: "a", type: "task", dependsOn: [], config: {} },
        b: { id: "b", type: "task", dependsOn: ["a"], config: {} },
        c: { id: "c", type: "task", dependsOn: ["b"], config: {} },
      },
    },
    registry(),
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("compile failed");
  return result.graph;
}

function member(nodeId: string, state: ClusterMember["state"] = "ALIVE", metadata: Record<string, string> = {}): ClusterMember {
  return {
    nodeId,
    address: `inproc://${nodeId}`,
    state,
    joinedAt: "2026-01-01T00:00:00.000Z",
    lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    metadata,
  };
}

describe("RFC-0009 distributed scheduler", () => {
  it("fails closed with zero ALIVE members", () => {
    const sched = createDistributedScheduler();
    const r = sched.place(linearGraph(), [member("n1", "DEAD")]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NO_ALIVE_MEMBERS");
  });

  it("places all nodes and prefers locality for dependents", () => {
    const sched = createDistributedScheduler({ localityWeight: 1, loadWeight: 0, affinityWeight: 0 });
    const members = [member("n1"), member("n2")];
    const r = sched.place(linearGraph(), members, { now: "2026-09-09T00:00:00.000Z" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(Object.keys(r.plan.placements).length, 3);
    // With pure locality, b and c should stick to wherever a landed.
    const aHost = r.plan.placements["a"]!.assignedNodeId;
    assert.equal(r.plan.placements["b"]!.assignedNodeId, aHost);
    assert.equal(r.plan.placements["c"]!.assignedNodeId, aHost);
    assert.ok(r.plan.placements["b"]!.reason.includes("locality"));
  });

  it("load-balances when locality weight is zero", () => {
    const sched = createDistributedScheduler({ localityWeight: 0, loadWeight: 1, affinityWeight: 0 });
    const graph = linearGraph();
    const r = sched.place(graph, [member("n1"), member("n2")], { now: "t" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const hosts = new Set(Object.values(r.plan.placements).map((p) => p.assignedNodeId));
    assert.equal(hosts.size, 2);
  });

  it("honours affinity tags on members", () => {
    const result = compile(
      {
        id: "wf-aff",
        version: "1",
        entrypoints: ["x"],
        nodes: {
          x: { id: "x", type: "task", dependsOn: [], config: { affinity: "gpu" } },
        },
      },
      registry(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const sched = createDistributedScheduler({ localityWeight: 0, loadWeight: 0, affinityWeight: 1 });
    const r = sched.place(result.graph, [member("cpu", "ALIVE", { role: "cpu" }), member("gpu1", "ALIVE", { role: "gpu" })]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.plan.placements["x"]!.assignedNodeId, "gpu1");
  });

  it("is deterministic across calls", () => {
    const sched = createDistributedScheduler();
    const members = [member("n2"), member("n1")];
    const g = linearGraph();
    const a = sched.place(g, members, { now: "t" });
    const b = sched.place(g, members, { now: "t" });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    assert.deepEqual(a.plan.placements, b.plan.placements);
  });

  it("records plans in the local ledger", () => {
    const sched = createDistributedScheduler();
    const r = sched.place(linearGraph(), [member("n1")], { now: "t" });
    assert.equal(r.ok, true);
    const saved = sched.ledger().get("wf-place");
    assert.ok(saved);
    assert.equal(saved?.plan.workflowId, "wf-place");
  });

  it("ignores SUSPECT members", () => {
    const sched = createDistributedScheduler();
    const r = sched.place(linearGraph(), [member("bad", "SUSPECT"), member("good", "ALIVE")]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    for (const p of Object.values(r.plan.placements)) {
      assert.equal(p.assignedNodeId, "good");
    }
  });
});
