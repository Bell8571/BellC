import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMessageBus } from "../src/messageBus.js";

describe("RFC-0010 message bus", () => {
  it("delivers publish to matching subscribers", () => {
    const bus = createMessageBus();
    const got: string[] = [];
    bus.subscribe("dag.events", "c1", (msg, ack) => {
      got.push(String(msg.payload));
      ack();
    });
    const r = bus.publish("dag.events", "hello", { id: "m1", now: "t" });
    assert.equal(r.ok, true);
    assert.deepEqual(got, ["hello"]);
    assert.equal(bus.pendingCount("c1"), 0);
    bus.close();
  });

  it("duplicate publish id is a no-op", () => {
    const bus = createMessageBus();
    let n = 0;
    bus.subscribe("s", "c", (_msg, ack) => {
      n += 1;
      ack();
    });
    const a = bus.publish("s", 1, { id: "same" });
    const b = bus.publish("s", 2, { id: "same" });
    assert.equal(a.ok && a.duplicate, false);
    assert.equal(b.ok && b.duplicate, true);
    assert.equal(n, 1);
    assert.equal(bus.backlogSize(), 1);
    bus.close();
  });

  it("at-least-once: unacked messages redeliver on reconnect", () => {
    const bus = createMessageBus();
    const got: string[] = [];
    bus.subscribe("s", "c1", (msg) => {
      got.push(String(msg.payload));
      // no ack
    });
    bus.publish("s", "a", { id: "1" });
    assert.equal(bus.pendingCount("c1"), 1);
    const n = bus.reconnect("c1");
    assert.equal(n, 1);
    assert.deepEqual(got, ["a", "a"]);
    bus.ack("c1", "1");
    assert.equal(bus.pendingCount("c1"), 0);
    assert.equal(bus.reconnect("c1"), 0);
    bus.close();
  });

  it("replayFrom delivers from sequence", () => {
    const bus = createMessageBus();
    bus.publish("s", "one", { id: "1" });
    bus.publish("s", "two", { id: "2" });
    const got: unknown[] = [];
    bus.subscribe("s", "late", (msg, ack) => {
      got.push(msg.payload);
      ack();
    });
    const n = bus.replayFrom("late", 2);
    assert.equal(n, 1);
    assert.deepEqual(got, ["two"]);
    bus.close();
  });

  it("wildcard subject dag.* matches one segment", () => {
    const bus = createMessageBus();
    const got: string[] = [];
    bus.subscribe("dag.*", "c", (msg, ack) => {
      got.push(msg.subject);
      ack();
    });
    bus.publish("dag.events", 1, { id: "a" });
    bus.publish("dag.events.nested", 2, { id: "b" });
    bus.publish("other", 3, { id: "c" });
    assert.deepEqual(got, ["dag.events"]);
    bus.close();
  });

  it("rejects empty subject and publish after close", () => {
    const bus = createMessageBus();
    const bad = bus.publish("", 1);
    assert.equal(bad.ok, false);
    bus.close();
    const closed = bus.publish("s", 1);
    assert.equal(closed.ok, false);
  });
});
