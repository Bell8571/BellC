import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFormalVerifier } from "../src/formalVerification.js";

describe("Formal verification research (RFC-0025)", () => {
  it("proves sound DAG batch certificates", () => {
    const v = createFormalVerifier({
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    const result = v.verifyDag({
      nodes: [
        { id: "a", dependsOn: [], batchIndex: 0 },
        { id: "b", dependsOn: ["a"], batchIndex: 1 },
        { id: "c", dependsOn: ["a"], batchIndex: 1 },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.ok, true);
    assert.ok(result.value.results.every((r) => r.status === "proven"));
  });

  it("violates topo when dependency batch is not lower", () => {
    const v = createFormalVerifier();
    const result = v.verifyDag({
      nodes: [
        { id: "a", dependsOn: [], batchIndex: 1 },
        { id: "b", dependsOn: ["a"], batchIndex: 0 },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.ok, false);
    assert.ok(
      result.value.results.some(
        (r) => r.name === "topo-batch-order" && r.status === "violated",
      ),
    );
  });

  it("proves and violates consensus traces", () => {
    const v = createFormalVerifier();
    const good = v.verifyConsensusTrace([
      {
        term: 1,
        leaderId: "n1",
        logIndex: 1,
        committed: true,
        aliveVoters: 3,
        clusterSize: 3,
      },
      {
        term: 1,
        leaderId: "n1",
        logIndex: 2,
        committed: true,
        aliveVoters: 3,
        clusterSize: 3,
      },
    ]);
    assert.equal(good.ok, true);
    if (!good.ok) return;
    assert.equal(good.value.ok, true);

    const bad = v.verifyConsensusTrace([
      {
        term: 1,
        leaderId: "n1",
        logIndex: 1,
        committed: true,
        aliveVoters: 1,
        clusterSize: 3,
      },
    ]);
    assert.equal(bad.ok, true);
    if (!bad.ok) return;
    assert.equal(bad.value.ok, false);
  });
});
