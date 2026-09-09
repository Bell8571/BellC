import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOsExecutionPlane } from "../src/osExecutionPlane.js";

describe("Smartware OS Alpha (RFC-0022)", () => {
  it("registers cloud and on-prem; refuses edge", () => {
    const plane = createOsExecutionPlane();
    assert.equal(
      plane.registerSubstrate({
        substrateId: "aws-1",
        kind: "cloud",
        endpoint: "https://cloud.local",
        healthy: true,
      }).ok,
      true,
    );
    assert.equal(
      plane.registerSubstrate({
        substrateId: "dc-1",
        kind: "on-prem",
        endpoint: "https://dc.local",
        healthy: true,
      }).ok,
      true,
    );
    const edge = plane.registerSubstrate({
      substrateId: "edge-1",
      kind: "edge" as "cloud",
      endpoint: "https://edge.local",
      healthy: true,
    });
    // Runtime kind is still "edge" — Alpha must deny.
    assert.equal(edge.ok, false);
    if (edge.ok) return;
    assert.equal(edge.code, "DENIED");
  });

  it("places without developer naming substrate", () => {
    const plane = createOsExecutionPlane();
    plane.registerSubstrate({
      substrateId: "cloud-a",
      kind: "cloud",
      endpoint: "https://a.local",
      healthy: true,
    });
    plane.registerSubstrate({
      substrateId: "prem-b",
      kind: "on-prem",
      endpoint: "https://b.local",
      healthy: true,
    });
    const decision = plane.place({ workflowId: "wf-1" });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.ok(["cloud-a", "prem-b"].includes(decision.value.substrateId));
    assert.equal(decision.value.preferAi, false);
  });

  it("self-optimizing prefers learned faster substrate", () => {
    const plane = createOsExecutionPlane();
    plane.registerSubstrate({
      substrateId: "aaa-slow",
      kind: "cloud",
      endpoint: "https://slow.local",
      healthy: true,
    });
    plane.registerSubstrate({
      substrateId: "zzz-fast",
      kind: "on-prem",
      endpoint: "https://fast.local",
      healthy: true,
    });
    for (let i = 0; i < 4; i++) {
      plane.observe({ nodeKey: "etl", hostId: "aaa-slow", costMs: 90 });
      plane.observe({ nodeKey: "etl", hostId: "zzz-fast", costMs: 15 });
    }
    const decision = plane.place({ workflowId: "wf-2", nodeKey: "etl" });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.substrateId, "zzz-fast");
    assert.equal(decision.value.preferAi, true);
    assert.equal(decision.value.reason, "self-optimizing-ai");
  });

  it("honours preferKind when healthy candidates exist", () => {
    const plane = createOsExecutionPlane();
    plane.registerSubstrate({
      substrateId: "c1",
      kind: "cloud",
      endpoint: "https://c.local",
      healthy: true,
    });
    plane.registerSubstrate({
      substrateId: "p1",
      kind: "on-prem",
      endpoint: "https://p.local",
      healthy: true,
    });
    const decision = plane.place({
      workflowId: "wf-3",
      preferKind: "on-prem",
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.kind, "on-prem");
  });

  it("fail-closes when no healthy substrates", () => {
    const plane = createOsExecutionPlane();
    plane.registerSubstrate({
      substrateId: "down",
      kind: "cloud",
      endpoint: "https://down.local",
      healthy: false,
    });
    const decision = plane.place({ workflowId: "wf-4" });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.code, "UNAVAILABLE");
  });
});
