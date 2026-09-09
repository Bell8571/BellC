import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMtlsTransportConfig, createInProcessTransport } from "../src/clusterTransport.js";
import { createTopologyManager, type TopologyClock } from "../src/topologyManager.js";

function manualClock(): TopologyClock & { advance(ms: number): void; nowMs: number } {
  let nowMs = 1_000_000;
  const timers: { at: number; fn: () => void; cleared: boolean }[] = [];
  return {
    get nowMs() {
      return nowMs;
    },
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms;
      for (const t of timers) {
        if (!t.cleared && t.at <= nowMs) {
          t.cleared = true;
          t.fn();
        }
      }
    },
    schedule(delayMs, fn) {
      const entry = { at: nowMs + delayMs, fn, cleared: false };
      timers.push(entry);
      return {
        clear() {
          entry.cleared = true;
        },
      };
    },
  };
}

describe("RFC-0008 mTLS defaults", () => {
  it("refuses network transport config without cert material", () => {
    const r = createMtlsTransportConfig(undefined);
    assert.equal(r.ok, false);
  });

  it("accepts complete cert material", () => {
    const r = createMtlsTransportConfig({ cert: "c", key: "k", ca: "a" });
    assert.equal(r.ok, true);
  });
});

describe("RFC-0008 topology manager", () => {
  it("join is idempotent for the same nodeId", () => {
    const clock = manualClock();
    const tm = createTopologyManager({
      nodeId: "a",
      address: "inproc://a",
      transport: createInProcessTransport("a"),
      clock,
      heartbeatIntervalMs: 10_000,
      failureTimeoutMs: 5_000,
    });
    const joins: string[] = [];
    tm.onMembershipChange((e) => {
      if (e.type === "JOINED") joins.push(e.member.nodeId);
    });
    tm.start();
    tm.admit("a", "inproc://a");
    tm.admit("a", "inproc://a");
    assert.equal(tm.snapshot().filter((m) => m.nodeId === "a").length, 1);
    tm.stop();
  });

  it("heartbeat keeps peer ALIVE; silence moves SUSPECT then DEAD", () => {
    const clock = manualClock();
    const tA = createInProcessTransport("a");
    const tB = createInProcessTransport("b");
    const a = createTopologyManager({
      nodeId: "a",
      address: "inproc://a",
      transport: tA,
      clock,
      heartbeatIntervalMs: 50_000,
      failureTimeoutMs: 1_000,
      suspectGraceMs: 500,
    });
    const b = createTopologyManager({
      nodeId: "b",
      address: "inproc://b",
      transport: tB,
      clock,
      heartbeatIntervalMs: 50_000,
      failureTimeoutMs: 1_000,
      suspectGraceMs: 500,
    });
    a.start();
    b.start();
    // Cross-admit for deterministic membership without relying on async join race.
    a.admit("b", "inproc://b");
    b.admit("a", "inproc://a");

    assert.equal(a.get("b")?.state, "ALIVE");

    clock.advance(1_000);
    a.tick();
    assert.equal(a.get("b")?.state, "SUSPECT");

    clock.advance(500);
    a.tick();
    assert.equal(a.get("b")?.state, "DEAD");

    a.stop();
    b.stop();
  });

  it("evict is idempotent", () => {
    const clock = manualClock();
    const tm = createTopologyManager({
      nodeId: "a",
      address: "inproc://a",
      transport: createInProcessTransport("a"),
      clock,
    });
    tm.start();
    tm.admit("x", "inproc://x");
    const events: string[] = [];
    tm.onMembershipChange((e) => {
      if (e.type === "EVICTED") events.push(e.nodeId);
    });
    tm.evict("x", "policy");
    tm.evict("x", "policy");
    assert.equal(tm.get("x")?.state, "EVICTED");
    assert.equal(events.length, 1);
    tm.stop();
  });

  it("two in-process peers receive JOIN broadcasts", () => {
    const clock = manualClock();
    const a = createTopologyManager({
      nodeId: "n1",
      address: "inproc://n1",
      transport: createInProcessTransport("n1"),
      clock,
      heartbeatIntervalMs: 60_000,
    });
    const b = createTopologyManager({
      nodeId: "n2",
      address: "inproc://n2",
      transport: createInProcessTransport("n2"),
      clock,
      heartbeatIntervalMs: 60_000,
    });
    b.start();
    a.start();
    assert.equal(b.get("n1")?.state, "ALIVE");
    b.joinSelf();
    assert.equal(a.get("n2")?.state, "ALIVE");
    a.stop();
    b.stop();
  });
});
