import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SOC2_CONTROL_CATALOG,
  buildSignedAssertion,
  createEnterpriseSecurity,
} from "../src/enterpriseSecurity.js";

describe("enterprise security (M3.5)", () => {
  const secret = "customer-idp-secret";
  const sp = "smartware-sp-local";

  function configured() {
    const sec = createEnterpriseSecurity({
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
      serviceProviderEntityId: sp,
      idFactory: () => "evt-1",
    });
    assert.equal(
      sec.configureIdp({
        entityId: "https://idp.customer.local",
        metadataLocation: "file:///etc/smartware/idp-metadata.xml",
        assertionHmacSecret: secret,
      }).ok,
      true,
    );
    return sec;
  }

  it("accepts valid SAML assertion and rejects bad signature", () => {
    const sec = configured();
    const fields = {
      issuer: "https://idp.customer.local",
      nameId: "user@customer.local",
      audience: sp,
      notBefore: "2026-09-09T11:00:00.000Z",
      notOnOrAfter: "2026-09-09T13:00:00.000Z",
    };
    const ok = sec.acceptAssertion(buildSignedAssertion(fields, secret));
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.value.principalId, "user@customer.local");

    const bad = sec.acceptAssertion({ ...buildSignedAssertion(fields, secret), signature: "dead" });
    assert.equal(bad.ok, false);
  });

  it("records and queries local audit events; export defaults off", async () => {
    const sec = configured();
    const rec = sec.recordAudit({
      actor: "user@customer.local",
      action: "workflow.run",
      resource: "wf-1",
      outcome: "success",
    });
    assert.equal(rec.ok, true);
    assert.equal(sec.queryAudit({ action: "workflow.run" }).length, 1);
    const flush = await sec.flushAuditExport();
    assert.equal(flush.ok, true);
    if (!flush.ok) return;
    assert.equal(flush.value.exported, 0);
  });

  it("fail-closes audit export when enabled without endpoint", async () => {
    const sec = createEnterpriseSecurity({
      auditExport: { enabled: true },
    });
    const flush = await sec.flushAuditExport();
    assert.equal(flush.ok, false);
    if (flush.ok) return;
    assert.equal(flush.code, "EXPORT_DENIED");
  });

  it("CMEK wrap/unwrap uses opaque key handles only", () => {
    const sec = configured();
    assert.equal(
      sec.registerKeyRef({
        keyId: "k1",
        handle: "cust-hsm-slot-9",
        algorithm: "AES-256-GCM",
      }).ok,
      true,
    );
    const plain = new TextEncoder().encode("secret-payload");
    const wrapped = sec.wrap("k1", plain);
    assert.equal(wrapped.ok, true);
    if (!wrapped.ok) return;
    const unwrapped = sec.unwrap("k1", wrapped.value.ciphertext);
    assert.equal(unwrapped.ok, true);
    if (!unwrapped.ok) return;
    assert.equal(new TextDecoder().decode(unwrapped.value.plaintext), "secret-payload");
  });

  it("enforces data residency allowlists fail-closed", () => {
    const sec = configured();
    assert.equal(sec.setResidency("ns-eu", ["eu-west", "eu-central"]).ok, true);
    assert.equal(sec.assertResidency("ns-eu", "eu-west").ok, true);
    const denied = sec.assertResidency("ns-eu", "us-east");
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.code, "RESIDENCY_VIOLATION");
  });

  it("exposes SOC 2 controls and never auto-certifies", () => {
    const sec = configured();
    assert.equal(sec.listSoc2Controls().length, SOC2_CONTROL_CATALOG.length);
    assert.equal(sec.isSoc2TypeIiCertified(), false);
    const updated = sec.updateSoc2Control("CC6.1", "evidenced", "SSO acceptance tests green");
    assert.equal(updated.ok, true);
    assert.equal(sec.isSoc2TypeIiCertified(), false);
  });
});
