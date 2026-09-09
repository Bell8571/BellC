/**
 * RFC-0002 Dependency Resolver v1 (Phase 1 runtime).
 * In-memory, fail-closed, idempotent.
 *
 * Implementation here is intentionally local-only (Phase 1),
 * and is sufficient for the M1.2–M1.5 wiring + tests in this repo.
 */

import { randomUUID } from "node:crypto";
import type { ResolvedExecutionGraph, ResolvedNode, RetryPolicy } from "./dagCompiler.js";
import { evaluatePredicate, gatedNodeIds, readPath, type ControlFlow } from "./predicates.js";

export type NodeState =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "TIMED_OUT"
  | "SKIPPED"
  | "CANCELLED"
  | "WAITING";

export type FailurePolicy = "HALT" | "CONTINUE";

export type ResolverInboundEvent =
  | { type: "NODE_STARTED"; nodeId: string; executionId: string; startedAt: string }
  | {
      type: "NODE_SUCCEEDED";
      nodeId: string;
      executionId: string;
      completedAt: string;
      output?: unknown;
    }
  | { type: "NODE_FAILED"; nodeId: string; executionId: string; failedAt: string; error: string }
  | { type: "NODE_TIMED_OUT"; nodeId: string; executionId: string; timedOutAt: string }
  | { type: "WORKFLOW_CANCEL"; requestedAt: string };

export type ResolverOutboundEvent =
  | {
      type: "NODE_READY";
      nodeId: string;
      node: ResolvedNode;
      idempotencyKey: string;
      attempt: number;
      timeoutDeadline: string;
    }
  | {
      type: "WORKFLOW_COMPLETED";
      workflowId: string;
      completedAt: string;
      nodeStates: Record<string, NodeState>;
    }
  | {
      type: "WORKFLOW_FAILED";
      workflowId: string;
      failedAt: string;
      failedNodes: string[];
      nodeStates: Record<string, NodeState>;
    }
  | { type: "RESOLVER_STATE_AMBIGUOUS"; nodeId: string; reason: string };

export interface ResolverNodeRecord {
  nodeId: string;
  state: NodeState;
  attempts: number;
  lastExecutionId?: string; // idempotencyKey issued by NODE_READY for the currently-running attempt
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  timeoutDeadline?: string;
  output?: unknown; // node output from NODE_SUCCEEDED
  loopIteration?: number; // for kind: loop
}

export interface ResolverConfig {
  failurePolicy: FailurePolicy;
  maxGlobalTimeout?: number;
  jitterSeed?: number;
  waitForTrigger?: string[];
}

export interface ResolverClock {
  now(): number;
  schedule(delayMs: number, fn: () => void): void;
}

export interface DependencyResolver {
  init(graph: ResolvedExecutionGraph, config: ResolverConfig): ResolverOutboundEvent[];
  handle(event: ResolverInboundEvent): ResolverOutboundEvent[];
  cancel(): ResolverOutboundEvent[];
  snapshot(): Record<string, ResolverNodeRecord>;
  resumeNode(nodeId: string): ResolverOutboundEvent[];
  onScheduled(handler: (events: ResolverOutboundEvent[]) => void): void;
  hydrate(nodes: Record<string, ResolverNodeRecord>): void;
}

const TERMINAL: ReadonlySet<NodeState> = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "SKIPPED",
  "CANCELLED",
]);

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepClone<T>(value: T): T {
  // Node 20+ supports structuredClone. Fallback to JSON for safety.
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function payloadOf(output: unknown): Record<string, unknown> | undefined {
  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return undefined;
}

export function createDependencyResolver(clock?: ResolverClock): DependencyResolver {
  const time: ResolverClock = clock ?? {
    now: () => Date.now(),
    schedule: (delayMs, fn) => {
      setTimeout(fn, delayMs);
    },
  };

  let graph: ResolvedExecutionGraph | undefined;
  let config: ResolverConfig | undefined;
  let records = new Map<string, ResolverNodeRecord>();
  let gatedArms = new Set<string>(); // nodes belonging to control-flow arms
  let inited = false;
  let finished = false;
  let cancelled = false;

  let rng = mulberry32(1);
  let scheduledReady: ((events: ResolverOutboundEvent[]) => void) | undefined;

  // Used to no-op duplicate events (idempotency envelope).
  const seenEvents = new Set<string>();

  // Phase 1 implementation runs single-process and is inherently sequential
  // under Node's event loop; keep resolver methods synchronous for correctness
  // (tests expect immediate return values).
  const withLock = (fn: () => ResolverOutboundEvent[]): ResolverOutboundEvent[] => fn();

  const states = (): Record<string, NodeState> => {
    const out: Record<string, NodeState> = {};
    for (const [id, rec] of records) out[id] = rec.state;
    return out;
  };

  const iso = (): string => new Date(time.now()).toISOString();

  const depsSatisfied = (node: ResolvedNode): boolean => {
    for (const dep of node.dependsOn) {
      const rec = records.get(dep);
      if (!rec) return false;
      if (rec.state !== "SUCCEEDED" && rec.state !== "SKIPPED") return false;
      if (rec.state === "SKIPPED" && config?.failurePolicy === "HALT") return false;
    }
    return true;
  };

  const emitReady = (nodeId: string, attempt: number, out: ResolverOutboundEvent[]): void => {
    if (!graph) return;
    const node = graph.nodes[nodeId];
    const rec = records.get(nodeId);
    if (!node || !rec) return;
    if (rec.state === "CANCELLED" || rec.state === "SKIPPED") return;
    const key = randomUUID();
    rec.state = "READY";
    rec.lastExecutionId = key;
    rec.attempts = attempt;
    rec.timeoutDeadline = new Date(time.now() + node.timeout).toISOString();
    rec.lastError = undefined;
    out.push({
      type: "NODE_READY",
      nodeId,
      node,
      idempotencyKey: key,
      attempt,
      timeoutDeadline: rec.timeoutDeadline,
    });
  };

  const skipTree = (nodeId: string): void => {
    const rec = records.get(nodeId);
    if (!rec) return;
    if (TERMINAL.has(rec.state) || rec.state === "RUNNING") return;
    if (rec.state === "PENDING") rec.state = "SKIPPED";

    const node = graph?.nodes[nodeId];
    for (const dep of node?.dependents ?? []) {
      const child = records.get(dep);
      if (!child) continue;
      if (child.state === "PENDING" || child.state === "READY" || child.state === "WAITING" || child.state === "RETRYING") {
        child.state = "SKIPPED";
        skipTree(dep);
      }
    }
  };

  const haltBranch = (nodeId: string, reason: string, out: ResolverOutboundEvent[]): void => {
    out.push({ type: "RESOLVER_STATE_AMBIGUOUS", nodeId, reason });
    const rec = records.get(nodeId);
    if (rec && !TERMINAL.has(rec.state) && rec.state !== "RUNNING") {
      rec.state = "SKIPPED";
    }
    const node = graph?.nodes[nodeId];
    for (const dep of node?.dependents ?? []) {
      const child = records.get(dep);
      if (child && (child.state === "PENDING" || child.state === "READY" || child.state === "WAITING" || child.state === "RETRYING")) {
        child.state = "SKIPPED";
        skipTree(dep);
      }
    }
  };

  const maybeFinish = (out: ResolverOutboundEvent[]): void => {
    if (!graph || finished) return;
    for (const rec of records.values()) {
      if (!TERMINAL.has(rec.state)) return;
    }
    finished = true;
    const failedNodes = [...records.values()]
      .filter((r) => r.state === "FAILED" || r.state === "TIMED_OUT" || r.state === "CANCELLED")
      .map((r) => r.nodeId);
    if (failedNodes.length === 0) {
      out.push({
        type: "WORKFLOW_COMPLETED",
        workflowId: graph.workflowId,
        completedAt: iso(),
        nodeStates: states(),
      });
    } else {
      out.push({
        type: "WORKFLOW_FAILED",
        workflowId: graph.workflowId,
        failedAt: iso(),
        failedNodes,
        nodeStates: states(),
      });
    }
  };

  const evaluateDependents = (nodeId: string, out: ResolverOutboundEvent[]): void => {
    if (!graph) return;
    const node = graph.nodes[nodeId];
    if (!node) return;
    for (const depId of node.dependents) {
      if (gatedArms.has(depId)) continue; // control-flow untaken arms are gated
      const depRec = records.get(depId);
      const depNode = graph.nodes[depId];
      if (!depRec || !depNode) continue;
      if (depRec.state !== "PENDING") continue;
      if (depsSatisfied(depNode)) {
        emitReady(depId, 1, out);
      }
    }
  };

  const applyFailurePolicy = (nodeId: string, out: ResolverOutboundEvent[]): void => {
    if (config?.failurePolicy === "HALT") {
      const node = graph?.nodes[nodeId];
      for (const dep of node?.dependents ?? []) skipTree(dep);
      return;
    }
    // CONTINUE: evaluate dependents normally.
    evaluateDependents(nodeId, out);
  };

  const retryDelay = (policy: RetryPolicy, failedAttempt: number): number => {
    const base = policy.backoffMs * policy.backoffMultiplier ** (failedAttempt - 1);
    const jitter = 1 + (rng() * 0.2 - 0.1);
    return Math.max(0, base * jitter);
  };

  const handleFailure = (
    nodeId: string,
    error: string,
    timedOut: boolean,
    out: ResolverOutboundEvent[],
  ): void => {
    if (!graph) return;
    const rec = records.get(nodeId);
    const node = graph.nodes[nodeId];
    if (!rec || !node) return;
    rec.lastError = error;

    if (rec.attempts < node.retryPolicy.maxAttempts) {
      rec.state = "RETRYING";
      const delay = retryDelay(node.retryPolicy, rec.attempts);
      const attempt = rec.attempts + 1;
      time.schedule(delay, () => {
        // retry transitions are routed as outbound events
        const events: ResolverOutboundEvent[] = [];
        // Note: this function is intentionally best-effort; callers can hydrate from durable state later.
        const current = records.get(nodeId);
        if (!current || current.state !== "RETRYING" || cancelled || finished) return;
        emitReady(nodeId, attempt, events);
        if (events.length > 0) scheduledReady?.(events);
      });
      return;
    }

    rec.state = timedOut ? "TIMED_OUT" : "FAILED";
    rec.completedAt = iso();
    applyFailurePolicy(nodeId, out);
    maybeFinish(out);
  };

  const applyIfControl = (
    nodeId: string,
    control: Extract<ControlFlow, { kind: "if" }>,
    output: unknown,
    out: ResolverOutboundEvent[],
  ): void => {
    const payload = payloadOf(output);
    const r = evaluatePredicate(control.predicate, payload);
    if (!r.ok) {
      haltBranch(nodeId, r.reason, out);
      maybeFinish(out);
      return;
    }
    const taken = r.value ? control.then : control.else;
    const skipped = r.value ? control.else : control.then;
    for (const id of skipped) skipTree(id);
    for (const id of taken) {
      const rec = records.get(id);
      const node = graph?.nodes[id];
      if (!rec || !node) continue;
      if (rec.state !== "PENDING") continue;
      if (depsSatisfied(node)) emitReady(id, 1, out);
    }
  };

  const handleControlAfterSuccess = (
    nodeId: string,
    node: ResolvedNode,
    output: unknown,
    out: ResolverOutboundEvent[],
  ): void => {
    if (!node.control) return;
    if (node.control.kind === "if") {
      applyIfControl(nodeId, node.control, output, out);
      return;
    }
    // For Phase 1 completeness: treat switch as if(predicate==equals case).
    if (node.control.kind === "switch") {
      const payload = payloadOf(output);
      const found = readPath(payload, node.control.path);
      if (found === undefined) {
        haltBranch(nodeId, `missing switch path ${node.control.path}`, out);
        maybeFinish(out);
        return;
      }
      const match = node.control.cases.find((c) => c.equals === found);
      const taken = match ? match.then : node.control.default;
      const skipped = node.control.cases.flatMap((c) => (c === match ? [] : c.then));
      if (!match) skipped.push(...node.control.default);
      for (const id of skipped) skipTree(id);
      for (const id of taken) {
        const rec = records.get(id);
        const target = graph?.nodes[id];
        if (!rec || !target) continue;
        if (rec.state !== "PENDING") continue;
        if (depsSatisfied(target)) emitReady(id, 1, out);
      }
      return;
    }
    if (node.control.kind === "loop") {
      // Minimal loop handling: if predicate is true, emitReady for the body nodes.
      // Body re-READY on subsequent completions is not covered by tests here.
      const payload = payloadOf(output);
      const r = evaluatePredicate(node.control.predicate, payload);
      if (!r.ok) {
        haltBranch(nodeId, r.reason, out);
        maybeFinish(out);
        return;
      }
      if (r.value) {
        for (const id of node.control.body) {
          const rec = records.get(id);
          const body = graph?.nodes[id];
          if (!rec || !body) continue;
          if (rec.state !== "PENDING") continue;
          if (depsSatisfied(body)) emitReady(id, 1, out);
        }
      }
      return;
    }
  };

  const initInner = (g: ResolvedExecutionGraph, cfg: ResolverConfig): ResolverOutboundEvent[] => {
    graph = g;
    config = cfg;
    rng = mulberry32(cfg.jitterSeed ?? hashSeed(g.workflowId));
    records = new Map();
    gatedArms = new Set();
    seenEvents.clear();
    cancelled = false;
    finished = false;

    const waitSet = new Set(cfg.waitForTrigger ?? []);

    for (const [id, node] of Object.entries(g.nodes)) {
      if (node.control) {
        for (const gatedId of gatedNodeIds(node.control)) gatedArms.add(gatedId);
      }
      records.set(id, {
        nodeId: id,
        state: waitSet.has(id) ? "WAITING" : "PENDING",
        attempts: 0,
      });
    }

    const out: ResolverOutboundEvent[] = [];
    // Emit entrypoints (nodes without dependencies) but never gate control-arm nodes.
    for (const [id, node] of Object.entries(g.nodes)) {
      const rec = records.get(id);
      if (!rec || rec.state !== "PENDING") continue;
      if (node.dependsOn.length === 0 && !gatedArms.has(id)) {
        emitReady(id, 1, out);
      }
    }

    if (cfg.maxGlobalTimeout !== undefined) {
      time.schedule(cfg.maxGlobalTimeout, () => {
        const events: ResolverOutboundEvent[] = [];
        if (!graph || finished) return;
        for (const rec of records.values()) {
          if (!TERMINAL.has(rec.state)) {
            rec.state = rec.state === "RUNNING" ? "TIMED_OUT" : "CANCELLED";
          }
        }
        finished = true;
        events.push({
          type: "WORKFLOW_FAILED",
          workflowId: g.workflowId,
          failedAt: iso(),
          failedNodes: [...records.values()].filter((r) => r.state !== "SUCCEEDED" && !TERMINAL.has(r.state)).map((r) => r.nodeId),
          nodeStates: states(),
        });
        maybeFinish(events);
      });
    }
    maybeFinish(out);
    return out;
  };

  const cancelInner = (): ResolverOutboundEvent[] => {
    const out: ResolverOutboundEvent[] = [];
    if (!graph) return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId: "", reason: "resolver not initialised" }];
    if (cancelled || finished) return out;
    cancelled = true;

    for (const rec of records.values()) {
      if (rec.state === "PENDING" || rec.state === "READY" || rec.state === "WAITING" || rec.state === "RETRYING") {
        rec.state = "CANCELLED";
      } else if (rec.state === "RUNNING") {
        rec.state = "CANCELLED";
      }
    }

    finished = true;
    const failedNodes = [...records.values()].filter((r) => r.state === "CANCELLED").map((r) => r.nodeId);
    out.push({
      type: "WORKFLOW_FAILED",
      workflowId: graph.workflowId,
      failedAt: iso(),
      failedNodes,
      nodeStates: states(),
    });
    return out;
  };

  const handleInner = (event: ResolverInboundEvent): ResolverOutboundEvent[] => {
    if (!inited || !graph) {
      return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId: "", reason: "resolver not initialised" }];
    }
    if (event.type === "WORKFLOW_CANCEL") {
      return cancelInner();
    }

    const rec = records.get(event.nodeId);
    if (!rec) {
      return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId: event.nodeId, reason: "unknown node" }];
    }

    const dupKey = `${event.type}:${event.nodeId}:${event.executionId}`;
    if (seenEvents.has(dupKey)) return [];

    if ("executionId" in event) {
      if (rec.lastExecutionId && event.executionId !== rec.lastExecutionId) {
        // fail-closed: halt affected branch only
        const out: ResolverOutboundEvent[] = [];
        haltBranch(event.nodeId, "idempotencyKey mismatch", out);
        maybeFinish(out);
        return out;
      }
    }

    if (event.type === "NODE_STARTED") {
      if (rec.state === "RUNNING" && rec.lastExecutionId === event.executionId) return [];
      if (rec.state !== "READY" && rec.state !== "RETRYING") {
        const out: ResolverOutboundEvent[] = [];
        haltBranch(event.nodeId, `illegal NODE_STARTED from ${rec.state}`, out);
        maybeFinish(out);
        return out;
      }
      seenEvents.add(dupKey);
      rec.state = "RUNNING";
      rec.startedAt = event.startedAt;
      return [];
    }

    if (event.type === "NODE_SUCCEEDED") {
      if (rec.state === "SUCCEEDED" && rec.lastExecutionId === event.executionId) return [];
      if (rec.state !== "RUNNING") {
        const out: ResolverOutboundEvent[] = [];
        haltBranch(event.nodeId, `illegal NODE_SUCCEEDED from ${rec.state}`, out);
        maybeFinish(out);
        return out;
      }
      seenEvents.add(dupKey);
      const out: ResolverOutboundEvent[] = [];
      rec.state = "SUCCEEDED";
      rec.completedAt = event.completedAt;
      rec.output = event.output;

      const node = graph.nodes[event.nodeId];
      if (!node) {
        haltBranch(event.nodeId, "unknown node after success", out);
        maybeFinish(out);
        return out;
      }
      // Apply optional control-flow behavior, then evaluate dependents (which will ignore gated arms).
      handleControlAfterSuccess(event.nodeId, node, event.output, out);
      // Only evaluate dependents if we didn't already finish/abort via ambiguous.
      evaluateDependents(event.nodeId, out);
      maybeFinish(out);
      return out;
    }

    if (event.type === "NODE_FAILED") {
      if (rec.state !== "RUNNING") {
        const out: ResolverOutboundEvent[] = [];
        haltBranch(event.nodeId, `illegal NODE_FAILED from ${rec.state}`, out);
        maybeFinish(out);
        return out;
      }
      seenEvents.add(dupKey);
      const out: ResolverOutboundEvent[] = [];
      handleFailure(event.nodeId, event.error, false, out);
      return out;
    }

    if (event.type === "NODE_TIMED_OUT") {
      if (rec.state !== "RUNNING") {
        const out: ResolverOutboundEvent[] = [];
        haltBranch(event.nodeId, `illegal NODE_TIMED_OUT from ${rec.state}`, out);
        maybeFinish(out);
        return out;
      }
      seenEvents.add(dupKey);
      const out: ResolverOutboundEvent[] = [];
      handleFailure(event.nodeId, "timed out", true, out);
      return out;
    }

    return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId: "", reason: "unhandled event" }];
  };

  return {
    init(g, cfg): ResolverOutboundEvent[] {
      return withLock(() => {
        if (inited && graph?.workflowId === g.workflowId) {
          return [];
        }
        inited = true;
        return initInner(g, cfg);
      });
    },

    handle(event): ResolverOutboundEvent[] {
      return withLock(() => handleInner(event));
    },

    cancel(): ResolverOutboundEvent[] {
      return withLock(() => cancelInner());
    },

    snapshot(): Record<string, ResolverNodeRecord> {
      const out: Record<string, ResolverNodeRecord> = {};
      for (const [id, rec] of records) out[id] = deepClone(rec);
      return out;
    },

    resumeNode(nodeId: string): ResolverOutboundEvent[] {
      return withLock(() => {
        const rec = records.get(nodeId);
        if (!rec || !graph) {
          return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId, reason: "unknown node" }];
        }
        if (rec.state !== "WAITING") {
          return [{ type: "RESOLVER_STATE_AMBIGUOUS", nodeId, reason: "node is not WAITING" }];
        }
        const out: ResolverOutboundEvent[] = [];
        emitReady(nodeId, 1, out);
        return out;
      });
    },

    onScheduled(handler): void {
      scheduledReady = handler;
    },

    hydrate(nodes): void {
      records = new Map();
      for (const [id, rec] of Object.entries(nodes)) {
        records.set(id, deepClone(rec));
      }
      inited = true;
    },
  };
}

