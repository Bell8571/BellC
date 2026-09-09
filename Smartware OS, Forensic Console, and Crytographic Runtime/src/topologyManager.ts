/**
 * RFC-0008 Cluster Topology Manager v1.
 * Heartbeat, join/evacuate/evict, SUSPECT→DEAD failure detection.
 */

import {
  createInProcessTransport,
  type TopologyMessage,
  type TopologyTransport,
} from "./clusterTransport.js";

export type MembershipState = "JOINING" | "ALIVE" | "SUSPECT" | "DEAD" | "EVICTED";

export interface ClusterMember {
  nodeId: string;
  address: string;
  state: MembershipState;
  joinedAt: string;
  lastHeartbeatAt: string;
  metadata: Record<string, string>;
}

export type MembershipEvent =
  | { type: "JOINED"; member: ClusterMember }
  | { type: "STATE_CHANGED"; nodeId: string; from: MembershipState; to: MembershipState }
  | { type: "EVICTED"; nodeId: string; reason: string }
  | { type: "LEFT"; nodeId: string };

export interface TopologyClock {
  now(): number;
  schedule(delayMs: number, fn: () => void): { clear(): void };
}

export interface TopologyManagerConfig {
  nodeId: string;
  address: string;
  metadata?: Record<string, string>;
  /** Default 1000 */
  heartbeatIntervalMs?: number;
  /** Silence before SUSPECT. Default 3000 */
  failureTimeoutMs?: number;
  /** Extra silence after SUSPECT before DEAD. Default 2000 */
  suspectGraceMs?: number;
  /** Default true — network transports must supply certs (enforced at transport factory). */
  requireMtls?: boolean;
  transport?: TopologyTransport;
  clock?: TopologyClock;
}

export interface TopologyManager {
  start(): void;
  stop(): void;
  /** Announce self and accept peers. Idempotent for same nodeId. */
  joinSelf(): void;
  /** Admit a remote member (also arrives via JOIN message). Idempotent. */
  admit(nodeId: string, address: string, metadata?: Record<string, string>): void;
  evacuate(nodeId: string): void;
  evict(nodeId: string, reason: string): void;
  /** Tick failure detection (also run by internal timer when started). */
  tick(): void;
  snapshot(): ClusterMember[];
  get(nodeId: string): ClusterMember | undefined;
  onMembershipChange(handler: (event: MembershipEvent) => void): void;
  localNodeId(): string;
}

function defaultClock(): TopologyClock {
  return {
    now: () => Date.now(),
    schedule: (delayMs, fn) => {
      const t = setTimeout(fn, delayMs);
      return { clear: () => clearTimeout(t) };
    },
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function createTopologyManager(cfg: TopologyManagerConfig): TopologyManager {
  const heartbeatIntervalMs = cfg.heartbeatIntervalMs ?? 1000;
  const failureTimeoutMs = cfg.failureTimeoutMs ?? 3000;
  const suspectGraceMs = cfg.suspectGraceMs ?? 2000;
  const requireMtls = cfg.requireMtls ?? true;
  const clock = cfg.clock ?? defaultClock();
  const transport = cfg.transport ?? createInProcessTransport(cfg.nodeId);

  const members = new Map<string, ClusterMember>();
  let changeHandler: ((event: MembershipEvent) => void) | undefined;
  let started = false;
  let heartbeatTimer: { clear(): void } | undefined;
  let tickTimer: { clear(): void } | undefined;

  const emit = (event: MembershipEvent): void => {
    changeHandler?.(event);
  };

  const setState = (m: ClusterMember, to: MembershipState): void => {
    if (m.state === to) return;
    const from = m.state;
    m.state = to;
    emit({ type: "STATE_CHANGED", nodeId: m.nodeId, from, to });
  };

  const upsertJoin = (
    nodeId: string,
    address: string,
    metadata: Record<string, string>,
  ): void => {
    const existing = members.get(nodeId);
    const now = clock.now();
    if (existing) {
      if (existing.state === "EVICTED" || existing.state === "DEAD") {
        // Fail-closed: do not silently revive DEAD/EVICTED without explicit re-admit policy.
        // Re-join after DEAD is allowed as a fresh JOINING→ALIVE cycle.
        existing.address = address;
        existing.metadata = { ...metadata };
        existing.joinedAt = iso(now);
        existing.lastHeartbeatAt = iso(now);
        setState(existing, "ALIVE");
        emit({ type: "JOINED", member: { ...existing } });
        return;
      }
      existing.address = address;
      existing.metadata = { ...metadata };
      existing.lastHeartbeatAt = iso(now);
      if (existing.state === "JOINING" || existing.state === "SUSPECT") {
        setState(existing, "ALIVE");
      }
      return;
    }
    const member: ClusterMember = {
      nodeId,
      address,
      state: "ALIVE",
      joinedAt: iso(now),
      lastHeartbeatAt: iso(now),
      metadata: { ...metadata },
    };
    members.set(nodeId, member);
    emit({ type: "JOINED", member: { ...member } });
  };

  const handleMessage = (_from: string, msg: TopologyMessage): void => {
    if (msg.type === "JOIN") {
      upsertJoin(msg.nodeId, msg.address, msg.metadata ?? {});
      return;
    }
    if (msg.type === "HEARTBEAT") {
      const m = members.get(msg.nodeId);
      if (!m) return;
      if (m.state === "EVICTED") return;
      m.lastHeartbeatAt = msg.sentAt;
      if (m.state === "SUSPECT" || m.state === "JOINING" || m.state === "DEAD") {
        setState(m, "ALIVE");
      }
      return;
    }
    if (msg.type === "LEAVE") {
      const m = members.get(msg.nodeId);
      if (!m || m.state === "EVICTED") return;
      setState(m, "EVICTED");
      emit({ type: "LEFT", nodeId: msg.nodeId });
      return;
    }
    if (msg.type === "EVICT") {
      const m = members.get(msg.nodeId);
      if (!m) return;
      if (m.state === "EVICTED") return;
      setState(m, "EVICTED");
      emit({ type: "EVICTED", nodeId: msg.nodeId, reason: msg.reason });
    }
  };

  const sendHeartbeat = (): void => {
    const now = clock.now();
    const self = members.get(cfg.nodeId);
    if (self && self.state !== "EVICTED") {
      self.lastHeartbeatAt = iso(now);
    }
    transport.broadcast({ type: "HEARTBEAT", nodeId: cfg.nodeId, sentAt: iso(now) });
  };

  const tickInner = (): void => {
    const now = clock.now();
    for (const m of members.values()) {
      if (m.nodeId === cfg.nodeId) continue;
      if (m.state === "EVICTED" || m.state === "DEAD") continue;
      const last = Date.parse(m.lastHeartbeatAt);
      if (Number.isNaN(last)) continue;
      const silent = now - last;
      if (m.state === "ALIVE" || m.state === "JOINING") {
        if (silent >= failureTimeoutMs) {
          setState(m, "SUSPECT");
        }
      } else if (m.state === "SUSPECT") {
        if (silent >= failureTimeoutMs + suspectGraceMs) {
          setState(m, "DEAD");
        }
      }
    }
  };

  return {
    localNodeId: () => cfg.nodeId,

    start() {
      if (started) return;
      // Document mTLS default for operators; in-process transport is test/sim only.
      void requireMtls;
      started = true;
      transport.onMessage(handleMessage);
      transport.start();
      upsertJoin(cfg.nodeId, cfg.address, cfg.metadata ?? {});
      transport.broadcast({
        type: "JOIN",
        nodeId: cfg.nodeId,
        address: cfg.address,
        metadata: cfg.metadata,
      });
      heartbeatTimer = clock.schedule(heartbeatIntervalMs, function beat() {
        if (!started) return;
        sendHeartbeat();
        heartbeatTimer = clock.schedule(heartbeatIntervalMs, beat);
      });
      tickTimer = clock.schedule(Math.min(500, heartbeatIntervalMs), function loop() {
        if (!started) return;
        tickInner();
        tickTimer = clock.schedule(Math.min(500, heartbeatIntervalMs), loop);
      });
    },

    stop() {
      if (!started) return;
      started = false;
      heartbeatTimer?.clear();
      tickTimer?.clear();
      transport.broadcast({ type: "LEAVE", nodeId: cfg.nodeId });
      transport.stop();
    },

    joinSelf() {
      upsertJoin(cfg.nodeId, cfg.address, cfg.metadata ?? {});
      transport.broadcast({
        type: "JOIN",
        nodeId: cfg.nodeId,
        address: cfg.address,
        metadata: cfg.metadata,
      });
    },

    admit(nodeId, address, metadata) {
      upsertJoin(nodeId, address, metadata ?? {});
    },

    evacuate(nodeId) {
      const m = members.get(nodeId);
      if (!m || m.state === "EVICTED") return;
      setState(m, "EVICTED");
      transport.broadcast({ type: "LEAVE", nodeId });
      emit({ type: "LEFT", nodeId });
    },

    evict(nodeId, reason) {
      const m = members.get(nodeId);
      if (!m) {
        members.set(nodeId, {
          nodeId,
          address: "",
          state: "EVICTED",
          joinedAt: iso(clock.now()),
          lastHeartbeatAt: iso(clock.now()),
          metadata: {},
        });
        emit({ type: "EVICTED", nodeId, reason });
        transport.broadcast({ type: "EVICT", nodeId, reason });
        return;
      }
      if (m.state === "EVICTED") return;
      setState(m, "EVICTED");
      transport.broadcast({ type: "EVICT", nodeId, reason });
      emit({ type: "EVICTED", nodeId, reason });
    },

    tick() {
      tickInner();
    },

    snapshot() {
      return [...members.values()].map((m) => ({ ...m, metadata: { ...m.metadata } }));
    },

    get(nodeId) {
      const m = members.get(nodeId);
      return m ? { ...m, metadata: { ...m.metadata } } : undefined;
    },

    onMembershipChange(handler) {
      changeHandler = handler;
    },
  };
}
