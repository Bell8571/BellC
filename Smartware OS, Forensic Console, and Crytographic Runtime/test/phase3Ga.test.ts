import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE3_GA_VERSION, runPhase3GaChecklist } from "../src/phase3Ga.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Smartware Cloud GA (M3.8)", () => {
  it("Phase 3 GA checklist passes with OS gate uncleared", async () => {
    const report = await runPhase3GaChecklist();
    assert.equal(report.version, PHASE3_GA_VERSION);
    assert.equal(report.ok, true);
    assert.equal(report.osGateCleared, false);
    assert.equal(report.checks.length, 8);
    assert.ok(report.checks.every((c) => c.ok));
    assert.equal(report.ownerwareDefaults.billingMeteringDefaultOff, true);
    assert.equal(report.ownerwareDefaults.soc2NotAutoCertified, true);
  });

  it("does not scaffold Smartware OS implementation sources", () => {
    const gaSrc = readFileSync(join(root, "src", "phase3Ga.ts"), "utf8");
    assert.equal(gaSrc.includes("smartwareOs"), false);
    assert.equal(gaSrc.includes("osGateCleared: false"), true);
  });
});
