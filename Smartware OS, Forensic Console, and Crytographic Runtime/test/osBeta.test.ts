import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOsBetaPlane } from "../src/osBeta.js";

describe("Smartware OS Beta (RFC-0023)", () => {
  it("accepts edge substrates", () => {
    const beta = createOsBetaPlane();
    const edge = beta.registerSubstrate({
      substrateId: "edge-1",
      kind: "edge",
      endpoint: "https://edge.local",
      healthy: true,
      healthScore: 95,
    });
    assert.equal(edge.ok, true);
    assert.equal(beta.listSubstrates()[0]?.kind, "edge");
  });

  it("selects kernel by annotation, affinity, then default order", () => {
    const beta = createOsBetaPlane();
    beta.registerKernel({ kind: "jvm", version: "17" });
    beta.registerKernel({
      kind: "gpu",
      version: "cuda-12",
      affinityTags: ["ml.infer"],
    });
    beta.registerKernel({ kind: "wasm", version: "1.0" });

    const annotated = beta.selectKernel({ annotation: "jvm" });
    assert.equal(annotated.ok, true);
    if (!annotated.ok) return;
    assert.equal(annotated.value.kernel, "jvm");
    assert.equal(annotated.value.reason, "node-annotation");

    const affinity = beta.selectKernel({ nodeType: "ml.infer" });
    assert.equal(affinity.ok, true);
    if (!affinity.ok) return;
    assert.equal(affinity.value.kernel, "gpu");

    const def = beta.selectKernel({});
    assert.equal(def.ok, true);
    if (!def.ok) return;
    assert.equal(def.value.kernel, "wasm");
    assert.equal(def.value.reason, "default-order");
  });

  it("heals by migrating off low healthScore substrates", () => {
    const beta = createOsBetaPlane({
      healThreshold: 40,
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    beta.registerSubstrate({
      substrateId: "sick",
      kind: "edge",
      endpoint: "https://sick.local",
      healthy: true,
      healthScore: 25,
    });
    beta.registerSubstrate({
      substrateId: "well",
      kind: "cloud",
      endpoint: "https://well.local",
      healthy: true,
      healthScore: 90,
    });
    const skipped = beta.healIfNeeded("wf", "well");
    assert.equal(skipped.ok, true);
    if (!skipped.ok) return;
    assert.deepEqual(skipped.value, { skipped: true });

    const migrated = beta.healIfNeeded("wf-1", "sick");
    assert.equal(migrated.ok, true);
    if (!migrated.ok) return;
    assert.equal("skipped" in migrated.value, false);
    if ("skipped" in migrated.value) return;
    assert.equal(migrated.value.toSubstrateId, "well");
    assert.equal(beta.listMigrations().length, 1);
  });

  it("fail-closes heal when no healthy target", () => {
    const beta = createOsBetaPlane({ healThreshold: 50 });
    beta.registerSubstrate({
      substrateId: "only",
      kind: "on-prem",
      endpoint: "https://only.local",
      healthy: true,
      healthScore: 10,
    });
    const result = beta.healIfNeeded("wf", "only");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "UNAVAILABLE");
  });
});
