import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createContainerAdapterStub,
  createInProcessAdapter,
  createServerlessRuntime,
  createWasmAdapterStub,
} from "../src/serverlessRuntime.js";

describe("serverless runtime (M3.2)", () => {
  it("cold-starts from empty pool then reuses warm instance", async () => {
    let clock = 1_000;
    let ids = 0;
    const rt = createServerlessRuntime({
      adapter: createInProcessAdapter(() => `i-${++ids}`),
      idleTtlMs: 10_000,
      now: () => clock,
    });
    const a = await rt.invoke({
      workflowId: "w",
      nodeId: "n1",
      payload: { x: 1 },
      idempotencyKey: "k1",
    });
    assert.equal(a.ok, true);
    assert.equal(a.coldStart, true);
    assert.equal(a.instanceId, "i-1");
    assert.equal(rt.snapshot().warmIdle, 1);

    clock += 100;
    const b = await rt.invoke({
      workflowId: "w",
      nodeId: "n2",
      payload: { x: 2 },
      idempotencyKey: "k2",
    });
    assert.equal(b.ok, true);
    assert.equal(b.coldStart, false);
    assert.equal(b.instanceId, "i-1");
  });

  it("scaleToZero disposes warm instances", async () => {
    const rt = createServerlessRuntime({
      adapter: createInProcessAdapter(),
    });
    await rt.ensureWarm(2);
    assert.equal(rt.snapshot().warmIdle, 2);
    await rt.scaleToZero();
    assert.equal(rt.snapshot().totalInstances, 0);
  });

  it("tick reclaims idle instances past TTL", async () => {
    let clock = 0;
    const rt = createServerlessRuntime({
      adapter: createInProcessAdapter(),
      idleTtlMs: 1_000,
      now: () => clock,
    });
    await rt.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: {},
      idempotencyKey: "a",
    });
    assert.equal(rt.snapshot().warmIdle, 1);
    clock = 1_001;
    await rt.tick();
    assert.equal(rt.snapshot().totalInstances, 0);
  });

  it("idempotent invoke returns prior result", async () => {
    const rt = createServerlessRuntime({
      adapter: createInProcessAdapter(),
    });
    const first = await rt.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: { v: 9 },
      idempotencyKey: "same",
    });
    const second = await rt.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: { v: 1 },
      idempotencyKey: "same",
    });
    assert.equal(second.ok, true);
    assert.deepEqual(second.output, first.output);
    assert.equal(rt.snapshot().coldStartCount, 1);
  });

  it("metering defaults OFF and stays local when enabled", async () => {
    const off = createServerlessRuntime({
      adapter: createInProcessAdapter(),
    });
    await off.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: {},
      idempotencyKey: "m0",
    });
    assert.equal(off.snapshot().meteringEnabled, false);
    assert.equal(off.meteringEvents().length, 0);

    const on = createServerlessRuntime({
      adapter: createInProcessAdapter(),
      meteringEnabled: true,
    });
    await on.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: {},
      idempotencyKey: "m1",
    });
    assert.equal(on.snapshot().meteringEnabled, true);
    assert.equal(on.meteringEvents().length, 1);
  });

  it("exposes container and wasm adapter kinds", async () => {
    const c = createServerlessRuntime({ adapter: createContainerAdapterStub() });
    const w = createServerlessRuntime({ adapter: createWasmAdapterStub() });
    assert.equal(c.kind(), "container");
    assert.equal(w.kind(), "wasm");
    const r = await c.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: { ok: true },
      idempotencyKey: "c1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.kind, "container");
  });

  it("tracks cold-start budget overruns", async () => {
    let clock = 0;
    const slow: ReturnType<typeof createInProcessAdapter> = {
      kind: "inprocess",
      async warm() {
        clock += 600;
        return { instanceId: "slow-1" };
      },
      async invoke() {
        return { output: {} };
      },
      async dispose() {},
    };
    const rt = createServerlessRuntime({
      adapter: slow,
      coldStartBudgetMs: 500,
      now: () => clock,
    });
    const r = await rt.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: {},
      idempotencyKey: "slow",
    });
    assert.equal(r.ok, true);
    assert.equal(r.withinColdStartBudget, false);
    assert.equal(rt.snapshot().coldStartsOverBudget, 1);
  });

  it("fail-closes without idempotencyKey", async () => {
    const rt = createServerlessRuntime({ adapter: createInProcessAdapter() });
    const r = await rt.invoke({
      workflowId: "w",
      nodeId: "n",
      payload: {},
      idempotencyKey: "",
    });
    assert.equal(r.ok, false);
  });
});
