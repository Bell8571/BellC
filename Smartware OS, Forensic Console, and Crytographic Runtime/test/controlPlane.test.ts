import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createControlPlane } from "../src/controlPlane.js";

describe("control plane alpha (M3.1)", () => {
  it("creates and lists clusters", () => {
    const cp = createControlPlane({
      now: () => 1_700_000_000_000,
      idFactory: () => "c1",
    });
    const created = cp.createCluster({
      name: "prod",
      version: "2.6.0",
      scaling: { desiredNodes: 2, minNodes: 1, maxNodes: 5 },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.clusterId, "c1");
    assert.equal(created.value.status, "ready");
    assert.equal(cp.listClusters().length, 1);
    assert.equal(cp.getCluster("c1")?.name, "prod");
  });

  it("rejects invalid scaling bounds", () => {
    const cp = createControlPlane();
    const bad = cp.createCluster({
      name: "x",
      scaling: { desiredNodes: 5, minNodes: 6, maxNodes: 10 },
    });
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.code, "INVALID");
  });

  it("registers nodes and enforces maxNodes", () => {
    const cp = createControlPlane({ idFactory: () => "c1" });
    assert.equal(
      cp.createCluster({
        name: "edge",
        scaling: { desiredNodes: 1, minNodes: 0, maxNodes: 2 },
      }).ok,
      true,
    );
    assert.equal(
      cp.registerNode({
        clusterId: "c1",
        nodeId: "n1",
        address: "inproc://n1",
      }).ok,
      true,
    );
    assert.equal(
      cp.registerNode({
        clusterId: "c1",
        nodeId: "n2",
        address: "inproc://n2",
      }).ok,
      true,
    );
    const over = cp.registerNode({
      clusterId: "c1",
      nodeId: "n3",
      address: "inproc://n3",
    });
    assert.equal(over.ok, false);
    if (over.ok) return;
    assert.equal(over.code, "DENIED");
  });

  it("reconcileScaling emits add and remove intents", () => {
    const cp = createControlPlane({ idFactory: () => "c1" });
    cp.createCluster({
      name: "s",
      scaling: { desiredNodes: 3, minNodes: 1, maxNodes: 5 },
    });
    cp.registerNode({ clusterId: "c1", nodeId: "a", address: "a" });
    const add = cp.reconcileScaling("c1");
    assert.equal(add.ok, true);
    if (!add.ok) return;
    assert.equal(add.value.type, "add");
    if (add.value.type === "add") assert.equal(add.value.count, 2);

    cp.registerNode({ clusterId: "c1", nodeId: "b", address: "b" });
    cp.registerNode({ clusterId: "c1", nodeId: "c", address: "c" });
    cp.registerNode({ clusterId: "c1", nodeId: "d", address: "d" });
    cp.setScalingPolicy("c1", { desiredNodes: 2, minNodes: 1, maxNodes: 5 });
    const rem = cp.reconcileScaling("c1");
    assert.equal(rem.ok, true);
    if (!rem.ok) return;
    assert.equal(rem.value.type, "remove");
    if (rem.value.type === "remove") {
      assert.equal(rem.value.nodeIds.length, 2);
    }
  });

  it("rolling upgrade drains workers then control nodes", () => {
    let ids = 0;
    const cp = createControlPlane({
      idFactory: () => `id-${++ids}`,
    });
    cp.createCluster({
      clusterId: "c1",
      name: "up",
      version: "2.6.0",
      scaling: { desiredNodes: 2, minNodes: 1, maxNodes: 5 },
    });
    cp.registerNode({
      clusterId: "c1",
      nodeId: "w1",
      address: "w1",
      role: "worker",
      version: "2.6.0",
    });
    cp.registerNode({
      clusterId: "c1",
      nodeId: "w2",
      address: "w2",
      role: "worker",
      version: "2.6.0",
    });
    cp.registerNode({
      clusterId: "c1",
      nodeId: "ctl",
      address: "ctl",
      role: "control",
      version: "2.6.0",
    });

    const started = cp.startRollingUpgrade("c1", "3.1.0", 2);
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.deepEqual(started.value.nodeOrder, ["w1", "w2", "ctl"]);
    assert.equal(cp.getCluster("c1")?.status, "upgrading");

    const step1 = cp.advanceUpgrade(started.value.planId);
    assert.equal(step1.ok, true);
    if (!step1.ok) return;
    assert.equal(step1.value.cursor, 2);
    assert.equal(step1.value.status, "in_progress");
    const mid = cp.getCluster("c1")!;
    assert.equal(mid.nodes.find((n) => n.nodeId === "w1")?.version, "3.1.0");
    assert.equal(mid.nodes.find((n) => n.nodeId === "ctl")?.version, "2.6.0");

    const step2 = cp.advanceUpgrade(started.value.planId);
    assert.equal(step2.ok, true);
    if (!step2.ok) return;
    assert.equal(step2.value.status, "completed");
    const done = cp.getCluster("c1")!;
    assert.equal(done.status, "ready");
    assert.equal(done.version, "3.1.0");
    assert.ok(done.nodes.every((n) => n.version === "3.1.0"));
  });

  it("decommission aborts upgrades and blocks mutations", () => {
    let ids = 0;
    const cp = createControlPlane({ idFactory: () => `id-${++ids}` });
    cp.createCluster({
      clusterId: "c1",
      name: "x",
      version: "1.0.0",
      scaling: { desiredNodes: 1, minNodes: 0, maxNodes: 3 },
    });
    cp.registerNode({ clusterId: "c1", nodeId: "n1", address: "n1" });
    const plan = cp.startRollingUpgrade("c1", "2.0.0", 1);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;

    const dc = cp.decommissionCluster("c1");
    assert.equal(dc.ok, true);
    assert.equal(cp.getUpgradePlan(plan.value.planId)?.status, "aborted");

    const reg = cp.registerNode({
      clusterId: "c1",
      nodeId: "n2",
      address: "n2",
    });
    assert.equal(reg.ok, false);
    if (reg.ok) return;
    assert.equal(reg.code, "DECOMMISSIONED");
  });

  it("refuses concurrent upgrades and empty clusters", () => {
    const cp = createControlPlane({ idFactory: () => "c1" });
    cp.createCluster({ name: "empty", version: "1.0.0" });
    const empty = cp.startRollingUpgrade("c1", "2.0.0");
    assert.equal(empty.ok, false);

    cp.registerNode({ clusterId: "c1", nodeId: "n1", address: "n1" });
    assert.equal(cp.startRollingUpgrade("c1", "2.0.0").ok, true);
    const again = cp.startRollingUpgrade("c1", "3.0.0");
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, "CONFLICT");
  });
});
