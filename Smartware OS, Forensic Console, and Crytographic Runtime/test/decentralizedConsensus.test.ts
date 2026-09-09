import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDecentralizedOrgConsensus } from "../src/decentralizedConsensus.js";

describe("Decentralized consensus research (RFC-0027)", () => {
  it("commits when quorum of distinct orgs attest the same payload", () => {
    const cons = createDecentralizedOrgConsensus({
      quorum: 2,
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
    });
    cons.registerOrg({ orgId: "org-a", attestationSecret: "sa" });
    cons.registerOrg({ orgId: "org-b", attestationSecret: "sb" });
    cons.registerOrg({ orgId: "org-c", attestationSecret: "sc" });

    cons.attest({ orgId: "org-a", workflowId: "wf-1", payload: "body" });
    const early = cons.tryCommit("wf-1");
    assert.equal(early.ok, false);
    if (early.ok) return;
    assert.equal(early.code, "QUORUM");

    cons.attest({ orgId: "org-b", workflowId: "wf-1", payload: "body" });
    const commit = cons.tryCommit("wf-1");
    assert.equal(commit.ok, true);
    if (!commit.ok) return;
    assert.equal(commit.value.attestingOrgs.length, 2);
    assert.equal(cons.listCommits().length, 1);
  });

  it("has no privileged coordinator — any orgs can form quorum", () => {
    const cons = createDecentralizedOrgConsensus({ quorum: 2 });
    cons.registerOrg({ orgId: "x", attestationSecret: "sx" });
    cons.registerOrg({ orgId: "y", attestationSecret: "sy" });
    cons.attest({ orgId: "y", workflowId: "wf", payload: "p" });
    cons.attest({ orgId: "x", workflowId: "wf", payload: "p" });
    const commit = cons.tryCommit("wf");
    assert.equal(commit.ok, true);
    if (!commit.ok) return;
    assert.deepEqual(commit.value.attestingOrgs, ["x", "y"]);
  });

  it("fail-closes on competing payload hashes without quorum on one side", () => {
    const cons = createDecentralizedOrgConsensus({ quorum: 2 });
    cons.registerOrg({ orgId: "a", attestationSecret: "sa" });
    cons.registerOrg({ orgId: "b", attestationSecret: "sb" });
    cons.attest({ orgId: "a", workflowId: "wf", payload: "one" });
    cons.attest({ orgId: "b", workflowId: "wf", payload: "two" });
    const commit = cons.tryCommit("wf");
    assert.equal(commit.ok, false);
    if (commit.ok) return;
    assert.ok(commit.code === "QUORUM" || commit.code === "MISMATCH");
  });
});
