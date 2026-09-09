import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConsensusCluster } from "../src/consensusStore.js";

describe("RFC-0011 consensus store", () => {
  it("elects a single leader with majority (I1, I5)", () => {
    const cluster = createConsensusCluster(["a", "b", "c"]);
    const leader = cluster.elect("b");
    assert.equal(leader, "b");
    assert.equal(cluster.leaderId(), "b");
    const leaders = cluster.nodes().filter((n) => n.role() === "leader");
    assert.equal(leaders.length, 1);
    assert.equal(leaders[0]?.id, "b");
  });

  it("rejects follower writes (I4)", () => {
    const cluster = createConsensusCluster(["a", "b", "c"]);
    cluster.elect("a");
    const follower = cluster.node("b")!;
    const r = follower.set("k", "v");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "NOT_LEADER");
  });

  it("commits KV through leader replicate (I3, I4)", () => {
    const cluster = createConsensusCluster(["a", "b", "c"]);
    cluster.elect("a");
    const leader = cluster.node("a")!;
    const w = leader.set("workflow", "running");
    assert.equal(w.ok, true);
    // Before replicate/commit, value must not be visible (I3).
    assert.equal(leader.get("workflow"), undefined);
    assert.equal(cluster.replicate(), true);
    assert.equal(leader.get("workflow"), "running");
    assert.equal(cluster.node("b")!.get("workflow"), "running");
    assert.equal(cluster.node("c")!.get("workflow"), "running");
  });

  it("delete replicates after commit", () => {
    const cluster = createConsensusCluster(["n1", "n2", "n3"]);
    cluster.elect("n1");
    const leader = cluster.node("n1")!;
    leader.set("x", "1");
    cluster.replicate();
    leader.del("x");
    cluster.replicate();
    assert.equal(leader.get("x"), undefined);
    assert.equal(cluster.node("n2")!.get("x"), undefined);
  });

  it("is deterministic: same preferred candidate wins", () => {
    const c1 = createConsensusCluster(["a", "b", "c"]);
    const c2 = createConsensusCluster(["a", "b", "c"]);
    assert.equal(c1.elect("c"), "c");
    assert.equal(c2.elect("c"), "c");
  });

  it("single-node cluster can elect and commit", () => {
    const cluster = createConsensusCluster(["solo"]);
    assert.equal(cluster.elect(), "solo");
    const n = cluster.node("solo")!;
    n.set("k", "v");
    assert.equal(cluster.replicate(), true);
    assert.equal(n.get("k"), "v");
  });
});
