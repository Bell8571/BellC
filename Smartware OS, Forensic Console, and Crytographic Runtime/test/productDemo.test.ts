import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProductDemo } from "../src/productDemo.js";

describe("Product end-to-end demo", () => {
  it("wires compile→run→heal→route→copilot→forensic→crypto", async () => {
    const report = await runProductDemo({
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
    assert.equal(report.chainValid, true);
    assert.ok(report.evidenceCount >= 5);
    assert.ok(report.steps.every((s) => s.ok));
  });
});
