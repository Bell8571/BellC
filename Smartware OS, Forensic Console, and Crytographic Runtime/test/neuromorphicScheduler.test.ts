import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNeuromorphicEdgeScheduler } from "../src/neuromorphicScheduler.js";

describe("Neuromorphic edge scheduling research (RFC-0026)", () => {
  it("places on lowest projected energy edge neuron", () => {
    const sched = createNeuromorphicEdgeScheduler({ energyBudget: 1000 });
    sched.registerNeuron({
      nodeId: "edge-a",
      spikeRateHz: 10,
      energyPerSpike: 5,
      healthy: true,
    });
    sched.registerNeuron({
      nodeId: "edge-b",
      spikeRateHz: 50,
      energyPerSpike: 1,
      healthy: true,
    });
    const place = sched.place({ workflowId: "wf", estimatedSpikes: 10 });
    assert.equal(place.ok, true);
    if (!place.ok) return;
    assert.equal(place.value.nodeId, "edge-b");
    assert.equal(place.value.projectedEnergy, 10);
    assert.equal(place.value.remainingBudget, 990);
  });

  it("fail-closes when budget exceeded", () => {
    const sched = createNeuromorphicEdgeScheduler({ energyBudget: 5 });
    sched.registerNeuron({
      nodeId: "edge-a",
      spikeRateHz: 1,
      energyPerSpike: 10,
      healthy: true,
    });
    const place = sched.place({ workflowId: "wf", estimatedSpikes: 2 });
    assert.equal(place.ok, false);
    if (place.ok) return;
    assert.equal(place.code, "BUDGET_EXCEEDED");
  });

  it("fail-closes with no healthy neurons", () => {
    const sched = createNeuromorphicEdgeScheduler({ energyBudget: 100 });
    sched.registerNeuron({
      nodeId: "down",
      spikeRateHz: 1,
      energyPerSpike: 1,
      healthy: false,
    });
    const place = sched.place({ workflowId: "wf", estimatedSpikes: 1 });
    assert.equal(place.ok, false);
    if (place.ok) return;
    assert.equal(place.code, "UNAVAILABLE");
  });
});
