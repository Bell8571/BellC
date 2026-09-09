/**
 * RFC-0010 Smartware Message Bus v1.
 * At-least-once delivery, idempotent publish ids, backlog reconnect replay.
 * Cluster-boundary only — no external broker.
 */

import { randomUUID } from "node:crypto";

export interface BusMessage {
  id: string;
  subject: string;
  payload: unknown;
  seq: number;
  publishedAt: string;
}

export type PublishResult =
  | { ok: true; message: BusMessage; duplicate: boolean }
  | { ok: false; code: "BUS_CLOSED" | "INVALID_SUBJECT"; message: string };

export interface BusSubscription {
  consumerId: string;
  subject: string;
  unsubscribe(): void;
}

export type BusHandler = (msg: BusMessage, ack: () => void) => void;

export interface MessageBus {
  publish(subject: string, payload: unknown, opts?: { id?: string; now?: string }): PublishResult;
  subscribe(subject: string, consumerId: string, handler: BusHandler): BusSubscription;
  /** Redeliver all unacked messages for this consumer (reconnect). */
  reconnect(consumerId: string): number;
  /** Replay backlog from seq (inclusive) to this consumer's subject filter. */
  replayFrom(consumerId: string, fromSeq: number): number;
  ack(consumerId: string, messageId: string): boolean;
  pendingCount(consumerId: string): number;
  backlogSize(): number;
  close(): void;
}

interface ConsumerState {
  consumerId: string;
  subject: string;
  handler: BusHandler;
  /** message ids awaiting ack */
  pending: Set<string>;
  active: boolean;
}

function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === subject) return true;
  // simple trailing * wildcard: "dag.*" matches "dag.events"
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1); // keep trailing path start: "dag."
    return subject.startsWith(prefix) && !subject.slice(prefix.length).includes(".");
  }
  if (pattern.endsWith(">")) {
    // "dag.>" matches "dag.a" and "dag.a.b"
    const prefix = pattern.slice(0, -1);
    return subject === prefix.slice(0, -1) || subject.startsWith(prefix);
  }
  return false;
}

export function createMessageBus(): MessageBus {
  const backlog: BusMessage[] = [];
  const byId = new Map<string, BusMessage>();
  const consumers = new Map<string, ConsumerState>();
  let nextSeq = 1;
  let closed = false;

  const deliver = (consumer: ConsumerState, msg: BusMessage): void => {
    if (!consumer.active) return;
    if (!subjectMatches(consumer.subject, msg.subject)) return;
    consumer.pending.add(msg.id);
    const ack = (): void => {
      consumer.pending.delete(msg.id);
    };
    consumer.handler(msg, ack);
  };

  const fanOut = (msg: BusMessage): void => {
    for (const c of consumers.values()) {
      if (!c.active) continue;
      deliver(c, msg);
    }
  };

  return {
    publish(subject, payload, opts = {}): PublishResult {
      if (closed) return { ok: false, code: "BUS_CLOSED", message: "message bus is closed" };
      if (typeof subject !== "string" || subject.trim() === "") {
        return { ok: false, code: "INVALID_SUBJECT", message: "subject required" };
      }
      const id = opts.id ?? randomUUID();
      const existing = byId.get(id);
      if (existing) {
        return { ok: true, message: existing, duplicate: true };
      }
      const message: BusMessage = {
        id,
        subject,
        payload,
        seq: nextSeq++,
        publishedAt: opts.now ?? new Date().toISOString(),
      };
      backlog.push(message);
      byId.set(id, message);
      fanOut(message);
      return { ok: true, message, duplicate: false };
    },

    subscribe(subject, consumerId, handler): BusSubscription {
      if (closed) {
        return {
          consumerId,
          subject,
          unsubscribe() {},
        };
      }
      const state: ConsumerState = {
        consumerId,
        subject,
        handler,
        pending: new Set(),
        active: true,
      };
      consumers.set(consumerId, state);
      return {
        consumerId,
        subject,
        unsubscribe() {
          const c = consumers.get(consumerId);
          if (c) c.active = false;
          consumers.delete(consumerId);
        },
      };
    },

    reconnect(consumerId): number {
      const c = consumers.get(consumerId);
      if (!c || !c.active) return 0;
      let n = 0;
      for (const msg of backlog) {
        if (!c.pending.has(msg.id)) continue;
        if (!subjectMatches(c.subject, msg.subject)) continue;
        deliver(c, msg);
        n += 1;
      }
      return n;
    },

    replayFrom(consumerId, fromSeq): number {
      const c = consumers.get(consumerId);
      if (!c || !c.active) return 0;
      let n = 0;
      for (const msg of backlog) {
        if (msg.seq < fromSeq) continue;
        if (!subjectMatches(c.subject, msg.subject)) continue;
        deliver(c, msg);
        n += 1;
      }
      return n;
    },

    ack(consumerId, messageId): boolean {
      const c = consumers.get(consumerId);
      if (!c) return false;
      if (!c.pending.has(messageId)) return false;
      c.pending.delete(messageId);
      return true;
    },

    pendingCount(consumerId): number {
      return consumers.get(consumerId)?.pending.size ?? 0;
    },

    backlogSize(): number {
      return backlog.length;
    },

    close(): void {
      closed = true;
      for (const c of consumers.values()) c.active = false;
      consumers.clear();
    },
  };
}
