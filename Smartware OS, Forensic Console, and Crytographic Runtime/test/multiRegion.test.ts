import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMultiRegionFabric } from "../src/multiRegion.js";

describe("multi-region fabric (M3.4)", () => {
  it("routes to lowest-latency healthy active region", () => {
    const fabric = createMultiRegionFabric({ mode: "active-active", overheadBudgetMs: 20 });
    assert.equal(
      fabric.registerRegion({
        regionId: "us-east",
        displayName: "US East",
        endpoint: "https://east.example.local",
        role: "active",
      }).ok,
      true,
    );
    assert.equal(
      fabric.registerRegion({
        regionId: "eu-west",
        displayName: "EU West",
        endpoint: "https://eu.example.local",
        role: "active",
      }).ok,
      true,
    );
    fabric.recordLatency("us-east", "eu-west", 45);
    const decision = fabric.route({
      workflowId: "w1",
      sourceRegionId: "us-east",
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.regionId, "us-east");
    assert.equal(decision.value.estimatedLatencyMs, 0);
    assert.equal(decision.value.withinSla, true);
  });

  it("active-passive failovers to standby when active unhealthy", () => {
    const fabric = createMultiRegionFabric({ mode: "active-passive" });
    fabric.registerRegion({
      regionId: "primary",
      displayName: "Primary",
      endpoint: "https://p.local",
      role: "active",
    });
    fabric.registerRegion({
      regionId: "dr",
      displayName: "DR",
      endpoint: "https://dr.local",
      role: "standby",
    });
    fabric.setHealthy("primary", false);
    const decision = fabric.route({ workflowId: "w" });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.regionId, "dr");
    assert.equal(decision.value.reason, "failover-standby");
  });

  it("refuses second active region in active-passive mode", () => {
    const fabric = createMultiRegionFabric({ mode: "active-passive" });
    fabric.registerRegion({
      regionId: "a",
      displayName: "A",
      endpoint: "https://a.local",
      role: "active",
    });
    const second = fabric.registerRegion({
      regionId: "b",
      displayName: "B",
      endpoint: "https://b.local",
      role: "active",
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
  });

  it("fail-closes when no healthy regions", () => {
    const fabric = createMultiRegionFabric();
    fabric.registerRegion({
      regionId: "only",
      displayName: "Only",
      endpoint: "https://o.local",
      role: "active",
      healthy: false,
    });
    const decision = fabric.route({ workflowId: "w" });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.code, "UNAVAILABLE");
  });

  it("pin prefers pinned region and reports overhead vs best", () => {
    const fabric = createMultiRegionFabric({ overheadBudgetMs: 20 });
    fabric.registerRegion({
      regionId: "near",
      displayName: "Near",
      endpoint: "https://near.local",
      role: "active",
    });
    fabric.registerRegion({
      regionId: "far",
      displayName: "Far",
      endpoint: "https://far.local",
      role: "active",
    });
    fabric.recordLatency("near", "far", 35);
    const decision = fabric.route({
      workflowId: "w",
      sourceRegionId: "near",
      pinRegionId: "far",
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.regionId, "far");
    assert.equal(decision.value.overheadMs, 35);
    assert.equal(decision.value.withinSla, false);
  });

  it("rejects unhealthy pin without allowUnhealthyPin", () => {
    const fabric = createMultiRegionFabric();
    fabric.registerRegion({
      regionId: "x",
      displayName: "X",
      endpoint: "https://x.local",
      role: "active",
    });
    fabric.setHealthy("x", false);
    const denied = fabric.route({ workflowId: "w", pinRegionId: "x" });
    assert.equal(denied.ok, false);
  });

  it("snapshot exposes fabric mode and samples", () => {
    const fabric = createMultiRegionFabric({ mode: "active-active" });
    fabric.registerRegion({
      regionId: "r1",
      displayName: "R1",
      endpoint: "https://r1.local",
      role: "active",
      clusterId: "c1",
    });
    fabric.registerRegion({
      regionId: "r2",
      displayName: "R2",
      endpoint: "https://r2.local",
      role: "active",
    });
    fabric.recordLatency("r1", "r2", 8);
    const snap = fabric.snapshot();
    assert.equal(snap.fabricMode, "active-active");
    assert.equal(snap.overheadBudgetMs, 20);
    assert.equal(snap.regions.length, 2);
    assert.equal(snap.latencySamples, 1);
  });
});
