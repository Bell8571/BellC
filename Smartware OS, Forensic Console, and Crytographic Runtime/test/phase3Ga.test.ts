import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE3_GA_VERSION, PHASE3_TO_OS_GATE, runPhase3GaChecklist } from "../src/phase3Ga.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Smartware Cloud GA (M3.8)", () => {
  it("Phase 3 GA checklist passes; OS gate reflects DRI record", async () => {
    const report = await runPhase3GaChecklist();
    assert.equal(report.version, PHASE3_GA_VERSION);
    assert.equal(report.ok, true);
    assert.equal(PHASE3_TO_OS_GATE.cleared, true);
    assert.equal(report.osGateCleared, true);
    assert.equal(report.checks.length, 8);
    assert.ok(report.checks.every((c) => c.ok));
    assert.equal(report.ownerwareDefaults.billingMeteringDefaultOff, true);
    assert.equal(report.ownerwareDefaults.soc2NotAutoCertified, true);
  });

  it("does not embed Smartware OS Alpha implementation in GA module", () => {
    const gaSrc = readFileSync(join(root, "src", "phase3Ga.ts"), "utf8");
    assert.equal(gaSrc.includes("createSmartwareOs"), false);
    assert.match(gaSrc, /PHASE3_TO_OS_GATE/);
  });
});
