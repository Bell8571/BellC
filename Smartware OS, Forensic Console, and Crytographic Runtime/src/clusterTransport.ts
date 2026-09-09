/**
 * RFC-0008 — network abstraction for cluster membership.
 * Socket transports require mTLS by default (Authority-0 Phase 2).
 */

export type TopologyMessage =
  | {
      type: "JOIN";
      nodeId: string;
      address: string;
      metadata?: Record<string, string>;
    }
  | { type: "HEARTBEAT"; nodeId: string; sentAt: string }
  | { type: "LEAVE"; nodeId: string }
  | { type: "EVICT"; nodeId: string; reason: string };

export interface TopologyTransport {
  start(): void;
  stop(): void;
  broadcast(msg: TopologyMessage): void;
  send(to: string, msg: TopologyMessage): void;
  onMessage(handler: (from: string, msg: TopologyMessage) => void): void;
}

export interface MtlsMaterial {
  cert: string;
  key: string;
  ca: string;
}

/**
 * In-process bus for single-process tests / simulation.
 * Not a production multi-host transport.
 */
export function createInProcessTransport(localNodeId: string): TopologyTransport {
  let handler: ((from: string, msg: TopologyMessage) => void) | undefined;
  let started = false;

  const deliver = (from: string, msg: TopologyMessage): void => {
    handler?.(from, msg);
  };

  registerInProcess(localNodeId, deliver);

  return {
    start() {
      started = true;
    },
    stop() {
      started = false;
      unregisterInProcess(localNodeId);
    },
    broadcast(msg) {
      if (!started) return;
      for (const [id, fn] of listInProcess()) {
        if (id === localNodeId) continue;
        fn(localNodeId, msg);
      }
    },
    send(to, msg) {
      if (!started) return;
      const fn = getInProcess(to);
      if (fn) fn(localNodeId, msg);
    },
    onMessage(h) {
      handler = h;
    },
  };
}

const inProcessPeers = new Map<string, (from: string, msg: TopologyMessage) => void>();

function registerInProcess(
  nodeId: string,
  fn: (from: string, msg: TopologyMessage) => void,
): void {
  inProcessPeers.set(nodeId, fn);
}

function unregisterInProcess(nodeId: string): void {
  inProcessPeers.delete(nodeId);
}

function listInProcess(): IterableIterator<[string, (from: string, msg: TopologyMessage) => void]> {
  return inProcessPeers.entries();
}

function getInProcess(nodeId: string): ((from: string, msg: TopologyMessage) => void) | undefined {
  return inProcessPeers.get(nodeId);
}

/** Fail-closed factory for future TCP+mTLS transport. */
export function createMtlsTransportConfig(material: MtlsMaterial | undefined): {
  ok: true;
  material: MtlsMaterial;
} | { ok: false; reason: string } {
  if (!material || !material.cert || !material.key || !material.ca) {
    return {
      ok: false,
      reason: "mTLS required by default: provide cert, key, and ca (Ownerware — customer-held keys)",
    };
  }
  return { ok: true, material };
}
