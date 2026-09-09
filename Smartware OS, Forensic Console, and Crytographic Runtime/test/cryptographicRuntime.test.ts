import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCryptographicRuntime } from "../src/cryptographicRuntime.js";

describe("Cryptographic Runtime (RFC-0030)", () => {
  it("signs and verifies with customer hmac key", () => {
    const rt = createCryptographicRuntime({ idFactory: () => "h1" });
    const key = rt.importKey({
      material: "customer-secret",
      algorithm: "hmac-sha256",
    });
    assert.equal(key.ok, true);
    if (!key.ok) return;
    const signed = rt.sign(key.value.handleId, "payload");
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    const good = rt.verify(signed.value, "payload");
    assert.equal(good.ok, true);
    const bad = rt.verify(signed.value, "tampered");
    assert.equal(bad.ok, false);
  });

  it("wraps and unwraps under aes-256-gcm handle", () => {
    const rt = createCryptographicRuntime({ idFactory: () => "aes1" });
    const key = rt.importKey({
      material: "wrap-key-material",
      algorithm: "aes-256-gcm",
    });
    assert.equal(key.ok, true);
    if (!key.ok) return;
    const wrapped = rt.wrap(key.value.handleId, "secret-bytes");
    assert.equal(wrapped.ok, true);
    if (!wrapped.ok) return;
    const unwrapped = rt.unwrap(wrapped.value);
    assert.equal(unwrapped.ok, true);
    if (!unwrapped.ok) return;
    assert.equal(new TextDecoder().decode(unwrapped.value.plaintext), "secret-bytes");
  });
});
