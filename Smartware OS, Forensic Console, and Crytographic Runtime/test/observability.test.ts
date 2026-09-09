import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createObservability } from "../src/observability.js";

describe("RFC-0013 observability", () => {
  it("defaults to local-only export disabled", () => {
    const init = createObservability();
    assert.equal(init.ok, true);
    if (!init.ok) return;
    assert.equal(init.observability.exportEnabled(), false);
  });

  it("fail-closes when export enabled without endpoint", () => {
    const init = createObservability({ export: { enabled: true } });
    assert.equal(init.ok, false);
    if (!init.ok) assert.equal(init.code, "EXPORT_ENDPOINT_REQUIRED");
  });

  it("records spans, counters, histograms, and logs locally", () => {
    const init = createObservability();
    assert.equal(init.ok, true);
    if (!init.ok) return;
    const obs = init.observability;
    const span = obs.startSpan("compile", { attributes: { workflow: "w1" }, nowMs: 1 });
    span.end("ok");
    obs.incr("nodes.ready", 2, { batch: 0 });
    obs.observe("place.score", 0.8);
    obs.log("info", "placed", { n: 3 });
    const snap = obs.snapshot();
    assert.equal(snap.spans.length, 1);
    assert.equal(snap.spans[0]!.status, "ok");
    assert.equal(snap.metrics.length, 2);
    assert.equal(snap.logs.length, 1);
    assert.equal(snap.exportEnabled, false);
  });

  it("flushExport is a no-op when local-only", async () => {
    const init = createObservability();
    assert.equal(init.ok, true);
    if (!init.ok) return;
    init.observability.incr("x", 1);
    const r = await init.observability.flushExport();
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.exported, 0);
  });

  it("opt-in export posts snapshot to customer endpoint", async () => {
    let posted = "";
    const init = createObservability({
      export: { enabled: true, endpoint: "https://collector.example.local/v1/otlp" },
      fetchImpl: (async (_url, initReq) => {
        posted = String(initReq?.body ?? "");
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(init.ok, true);
    if (!init.ok) return;
    init.observability.log("warn", "hello");
    const r = await init.observability.flushExport();
    assert.equal(r.ok, true);
    assert.ok(posted.includes("hello"));
  });
});
