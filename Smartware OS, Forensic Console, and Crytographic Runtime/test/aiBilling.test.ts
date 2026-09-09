import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAiScheduler } from "../src/aiScheduler.js";
import { createBillingEngine } from "../src/billingEngine.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("AI scheduler (M3.7)", () => {
  it("beats round-robin when lex-first host is slower", () => {
    const ai = createAiScheduler({ minSamples: 3 });
    for (let i = 0; i < 4; i++) {
      ai.record({ nodeKey: "http", hostId: "aaa-slow", costMs: 80 });
      ai.record({ nodeKey: "http", hostId: "zzz-fast", costMs: 12 });
    }
    const rec = ai.recommend("http", ["aaa-slow", "zzz-fast"]);
    assert.equal(rec.roundRobinHostId, "aaa-slow");
    assert.equal(rec.aiHostId, "zzz-fast");
    assert.equal(rec.preferAi, true);
    assert.equal(rec.reason, "ai-beats-round-robin");
    assert.ok(rec.aiMeanCost < rec.roundRobinMeanCost);
  });

  it("does not prefer AI without enough samples", () => {
    const ai = createAiScheduler({ minSamples: 5 });
    ai.record({ nodeKey: "x", hostId: "h1", costMs: 1 });
    const rec = ai.recommend("x", ["h1", "h2"]);
    assert.equal(rec.preferAi, false);
    assert.equal(rec.reason, "insufficient-samples");
  });
});

describe("billing engine (M3.7)", () => {
  it("defaults metering OFF and skips records", () => {
    const billing = createBillingEngine();
    assert.equal(billing.meteringEnabled(), false);
    const r = billing.record({
      namespaceId: "ns",
      workflowId: "w",
      nodeId: "n",
      units: 1,
      unitKind: "node-execution",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value, { skipped: true });
    assert.equal(billing.listMeters().length, 0);
  });

  it("records meters and enforces budgets when enabled", () => {
    const billing = createBillingEngine({
      meteringEnabled: true,
      idFactory: () => "m1",
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    assert.equal(billing.setBudget("ns", 5).ok, true);
    assert.equal(
      billing.record({
        namespaceId: "ns",
        workflowId: "w",
        nodeId: "a",
        units: 3,
        unitKind: "node-execution",
      }).ok,
      true,
    );
    assert.equal(billing.usage("ns"), 3);
    const over = billing.record({
      namespaceId: "ns",
      workflowId: "w",
      nodeId: "b",
      units: 3,
      unitKind: "node-execution",
    });
    assert.equal(over.ok, false);
    if (over.ok) return;
    assert.equal(over.code, "BUDGET_EXCEEDED");
    assert.equal(billing.alerts().length, 1);
  });

  it("keeps billing module separate from AI scheduler source", () => {
    const aiSrc = readFileSync(join(root, "src", "aiScheduler.ts"), "utf8");
    const execSrc = readFileSync(join(root, "src", "executionEngine.ts"), "utf8");
    assert.equal(aiSrc.includes("billingEngine"), false);
    assert.equal(execSrc.includes("billingEngine"), false);
  });
});
