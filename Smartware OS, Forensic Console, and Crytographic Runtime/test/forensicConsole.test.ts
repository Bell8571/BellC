import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createForensicConsole } from "../src/forensicConsole.js";

describe("Forensic Console (RFC-0029)", () => {
  it("appends hash-chained evidence and verifies", () => {
    const fc = createForensicConsole({
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    const a = fc.record({
      kind: "compile",
      workflowId: "wf",
      runId: "r1",
      detail: { ok: true },
    });
    assert.equal(a.ok, true);
    const b = fc.record({
      kind: "run_complete",
      workflowId: "wf",
      runId: "r1",
      detail: { terminal: "COMPLETED" },
    });
    assert.equal(b.ok, true);
    if (!b.ok || !a.ok) return;
    assert.equal(b.value.prevHash, a.value.hash);
    const chain = fc.verifyChain();
    assert.equal(chain.ok, true);
    assert.equal(fc.list({ runId: "r1" }).length, 2);
  });

  it("fail-closes export by default", async () => {
    const fc = createForensicConsole();
    fc.record({ kind: "custom", workflowId: "wf" });
    const exp = await fc.exportEvidence();
    assert.equal(exp.ok, false);
    if (exp.ok) return;
    assert.equal(exp.code, "DENIED");
  });
});
