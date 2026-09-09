import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMarketplaceRegistry } from "../src/marketplace.js";

describe("marketplace registry (M3.6)", () => {
  it("requires approved partner and signs packages", () => {
    const reg = createMarketplaceRegistry({
      now: () => Date.parse("2026-09-09T12:00:00.000Z"),
      idFactory: () => "pkg-1",
    });
    assert.equal(
      reg.onboardPartner({
        partnerId: "acme",
        displayName: "Acme Plugins",
        signingSecret: "acme-secret",
      }).ok,
      true,
    );
    const denied = reg.publish({
      partnerId: "acme",
      name: "http.request",
      version: "1.0.0",
      kind: "node-type",
      payload: JSON.stringify({ type: "http.request" }),
    });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.code, "DENIED");

    assert.equal(reg.approvePartner("acme").ok, true);
    const pub = reg.publish({
      partnerId: "acme",
      name: "http.request",
      version: "1.0.0",
      kind: "node-type",
      payload: JSON.stringify({ type: "http.request" }),
    });
    assert.equal(pub.ok, true);
    if (!pub.ok) return;
    assert.ok(pub.value.signature.length > 0);
    assert.equal(reg.verify("pkg-1").ok, true);
  });

  it("detects tampered signatures", () => {
    const reg = createMarketplaceRegistry({ idFactory: () => "pkg-t" });
    reg.onboardPartner({
      partnerId: "p1",
      displayName: "P1",
      signingSecret: "s1",
    });
    reg.approvePartner("p1");
    assert.equal(
      reg.publish({
        partnerId: "p1",
        name: "tpl",
        version: "0.1.0",
        kind: "template",
        payload: "hello",
      }).ok,
      true,
    );
    const mirror = reg.exportMirror({ includeSecrets: true });
    const bad = {
      ...mirror,
      packages: mirror.packages.map((p) =>
        p.packageId === "pkg-t" ? { ...p, signature: "00".repeat(32) } : p,
      ),
    };
    const other = createMarketplaceRegistry();
    assert.equal(other.importMirror(bad).ok, true);
    const v = other.verify("pkg-t");
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.code, "BAD_SIGNATURE");
  });

  it("round-trips mirror for air-gapped install", () => {
    const source = createMarketplaceRegistry({ idFactory: () => "pkg-air" });
    source.onboardPartner({
      partnerId: "air",
      displayName: "Air",
      signingSecret: "air-secret",
    });
    source.approvePartner("air");
    assert.equal(
      source.publish({
        partnerId: "air",
        name: "local-node",
        version: "1.0.0",
        kind: "node-type",
        payload: '{"type":"local-node"}',
      }).ok,
      true,
    );
    const mirror = source.exportMirror({ includeSecrets: true });
    assert.equal(mirror.version, 1);
    assert.equal(mirror.packages.length, 1);

    const dest = createMarketplaceRegistry();
    const imported = dest.importMirror(mirror);
    assert.equal(imported.ok, true);
    assert.equal(dest.verify("pkg-air").ok, true);
    assert.equal(dest.listPackages({ kind: "node-type" }).length, 1);
  });

  it("fail-closes import without secrets when required", () => {
    const source = createMarketplaceRegistry({ idFactory: () => "pkg-x" });
    source.onboardPartner({
      partnerId: "x",
      displayName: "X",
      signingSecret: "xs",
    });
    source.approvePartner("x");
    source.publish({
      partnerId: "x",
      name: "n",
      version: "1.0.0",
      kind: "node-type",
      payload: "p",
    });
    const stripped = source.exportMirror({ includeSecrets: false });
    const dest = createMarketplaceRegistry({ requireSecretsOnImport: true });
    const result = dest.importMirror(stripped);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "DENIED");
  });

  it("lists packages by kind and partner", () => {
    let n = 0;
    const reg = createMarketplaceRegistry({ idFactory: () => `pkg-${++n}` });
    reg.onboardPartner({
      partnerId: "a",
      displayName: "A",
      signingSecret: "sa",
    });
    reg.approvePartner("a");
    reg.publish({
      partnerId: "a",
      name: "t1",
      version: "1.0.0",
      kind: "template",
      payload: "1",
    });
    reg.publish({
      partnerId: "a",
      name: "n1",
      version: "1.0.0",
      kind: "node-type",
      payload: "2",
    });
    assert.equal(reg.listPackages({ kind: "template" }).length, 1);
    assert.equal(reg.listPackages({ partnerId: "a" }).length, 2);
  });
});
