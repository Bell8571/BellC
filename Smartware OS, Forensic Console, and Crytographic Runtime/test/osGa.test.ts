import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMarketplaceRegistry } from "../src/marketplace.js";
import { createOsGaRuntime } from "../src/osGa.js";

function seededRegistry() {
  const reg = createMarketplaceRegistry({
    now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    idFactory: () => "pkg-1",
  });
  reg.onboardPartner({
    partnerId: "p1",
    displayName: "Partner One",
    signingSecret: "secret-one",
  });
  reg.approvePartner("p1");
  const pub = reg.publish({
    partnerId: "p1",
    name: "http.fetch",
    version: "1.0.0",
    kind: "node-type",
    payload: "module-bytes",
    packageId: "pkg-1",
  });
  assert.equal(pub.ok, true);
  return reg;
}

describe("Smartware OS GA (RFC-0024)", () => {
  it("resolves marketplace packages as runtime dependencies after verify", () => {
    const ga = createOsGaRuntime({ registry: seededRegistry() });
    const deps = ga.resolveDependencies([
      { nodeId: "n1", packageName: "http.fetch", version: "1.0.0" },
    ]);
    assert.equal(deps.ok, true);
    if (!deps.ok) return;
    assert.equal(deps.value.length, 1);
    assert.equal(deps.value[0]?.packageId, "pkg-1");
    assert.equal(deps.value[0]?.verified, true);
  });

  it("fail-closes on missing or bad package", () => {
    const ga = createOsGaRuntime({ registry: seededRegistry() });
    const missing = ga.resolveDependencies([
      { nodeId: "n1", packageName: "no.such", version: "9.9.9" },
    ]);
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.code, "NOT_FOUND");
  });

  it("routes globally without preferring cloud over edge", () => {
    const ga = createOsGaRuntime({ registry: seededRegistry() });
    ga.registerSubstrate({
      substrateId: "cloud-slow",
      kind: "cloud",
      endpoint: "https://cloud",
      healthy: true,
      latencyMs: 80,
      healthScore: 100,
    });
    ga.registerSubstrate({
      substrateId: "edge-fast",
      kind: "edge",
      endpoint: "https://edge",
      healthy: true,
      latencyMs: 12,
      healthScore: 90,
    });
    ga.registerSubstrate({
      substrateId: "onprem-mid",
      kind: "on-prem",
      endpoint: "https://onprem",
      healthy: true,
      latencyMs: 40,
      healthScore: 95,
    });

    const decision = ga.route({ workflowId: "wf", nodeId: "n1" });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.substrateId, "edge-fast");
    assert.equal(decision.value.kind, "edge");
    assert.equal(decision.value.reason, "global-lowest-latency");
  });

  it("honours preferKind only as soft filter when healthy candidates exist", () => {
    const ga = createOsGaRuntime({ registry: seededRegistry() });
    ga.registerSubstrate({
      substrateId: "edge-1",
      kind: "edge",
      endpoint: "https://e",
      healthy: true,
      latencyMs: 5,
      healthScore: 80,
    });
    ga.registerSubstrate({
      substrateId: "cloud-1",
      kind: "cloud",
      endpoint: "https://c",
      healthy: true,
      latencyMs: 50,
      healthScore: 80,
    });
    const decision = ga.route({
      workflowId: "wf",
      nodeId: "n1",
      preferKind: "cloud",
    });
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.value.kind, "cloud");
    assert.equal(decision.value.reason, "prefer-kind-then-latency");
  });

  it("fail-closes route when no healthy substrates", () => {
    const ga = createOsGaRuntime({ registry: seededRegistry() });
    ga.registerSubstrate({
      substrateId: "down",
      kind: "cloud",
      endpoint: "https://down",
      healthy: false,
      latencyMs: 1,
      healthScore: 0,
    });
    const decision = ga.route({ workflowId: "wf", nodeId: "n1" });
    assert.equal(decision.ok, false);
    if (decision.ok) return;
    assert.equal(decision.code, "UNAVAILABLE");
  });
});
