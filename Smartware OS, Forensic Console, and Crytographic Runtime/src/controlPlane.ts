/**
 * RFC-0014 Managed Control Plane Alpha.
 * Self-hostable cluster lifecycle, scaling policy, rolling upgrades.
 * No phone-home. No billing/metering.
 */

export type ClusterStatus =
  | "provisioning"
  | "ready"
  | "upgrading"
  | "degraded"
  | "decommissioned";

export type ControlPlaneNodeRole = "worker" | "control";

export type ControlPlaneNodeState =
  | "pending"
  | "ready"
  | "draining"
  | "upgrading"
  | "retired";

export interface ScalingPolicy {
  desiredNodes: number;
  minNodes: number;
  maxNodes: number;
}

export interface ControlPlaneNode {
  nodeId: string;
  address: string;
  role: ControlPlaneNodeRole;
  version: string;
  state: ControlPlaneNodeState;
}

export interface ClusterRecord {
  clusterId: string;
  name: string;
  status: ClusterStatus;
  createdAt: string;
  version: string;
  scaling: ScalingPolicy;
  nodes: ControlPlaneNode[];
}

export type UpgradePlanStatus = "pending" | "in_progress" | "completed" | "aborted";

export interface UpgradePlan {
  planId: string;
  clusterId: string;
  fromVersion: string;
  toVersion: string;
  batchSize: number;
  nodeOrder: string[];
  cursor: number;
  status: UpgradePlanStatus;
}

export type ScaleIntent =
  | { type: "add"; count: number }
  | { type: "remove"; nodeIds: string[] }
  | { type: "noop" };

export type ControlPlaneResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "INVALID"
        | "CONFLICT"
        | "DECOMMISSIONED"
        | "DENIED";
      message: string;
    };

export interface CreateClusterInput {
  name: string;
  version?: string;
  scaling?: Partial<ScalingPolicy>;
  /** Deterministic id for tests; otherwise generated. */
  clusterId?: string;
}

export interface RegisterNodeInput {
  clusterId: string;
  nodeId: string;
  address: string;
  role?: ControlPlaneNodeRole;
  version?: string;
}

export interface ControlPlane {
  createCluster(input: CreateClusterInput): ControlPlaneResult<ClusterRecord>;
  getCluster(clusterId: string): ClusterRecord | undefined;
  listClusters(): ClusterRecord[];
  decommissionCluster(clusterId: string): ControlPlaneResult<ClusterRecord>;
  registerNode(input: RegisterNodeInput): ControlPlaneResult<ControlPlaneNode>;
  setScalingPolicy(
    clusterId: string,
    policy: ScalingPolicy,
  ): ControlPlaneResult<ClusterRecord>;
  reconcileScaling(clusterId: string): ControlPlaneResult<ScaleIntent>;
  startRollingUpgrade(
    clusterId: string,
    toVersion: string,
    batchSize?: number,
  ): ControlPlaneResult<UpgradePlan>;
  advanceUpgrade(planId: string): ControlPlaneResult<UpgradePlan>;
  getUpgradePlan(planId: string): UpgradePlan | undefined;
}

export interface ControlPlaneConfig {
  /** Injected clock for tests. */
  now?: () => number;
  /** Id factory for clusters/plans. */
  idFactory?: () => string;
}

function validateScaling(policy: ScalingPolicy): string | undefined {
  const { minNodes, desiredNodes, maxNodes } = policy;
  if (
    !Number.isInteger(minNodes) ||
    !Number.isInteger(desiredNodes) ||
    !Number.isInteger(maxNodes)
  ) {
    return "scaling bounds must be integers";
  }
  if (minNodes < 0 || desiredNodes < 0 || maxNodes < 0) {
    return "scaling bounds must be non-negative";
  }
  if (minNodes > desiredNodes || desiredNodes > maxNodes) {
    return "require 0 ≤ minNodes ≤ desiredNodes ≤ maxNodes";
  }
  return undefined;
}

function cloneCluster(c: ClusterRecord): ClusterRecord {
  return {
    ...c,
    scaling: { ...c.scaling },
    nodes: c.nodes.map((n) => ({ ...n })),
  };
}

function clonePlan(p: UpgradePlan): UpgradePlan {
  return { ...p, nodeOrder: [...p.nodeOrder] };
}

let seq = 0;

export function createControlPlane(cfg: ControlPlaneConfig = {}): ControlPlane {
  const now = cfg.now ?? (() => Date.now());
  const idFactory =
    cfg.idFactory ??
    (() => {
      seq += 1;
      return `cp-${now().toString(36)}-${seq.toString(36)}`;
    });

  const clusters = new Map<string, ClusterRecord>();
  const plans = new Map<string, UpgradePlan>();

  const requireMutable = (
    clusterId: string,
  ): ControlPlaneResult<ClusterRecord> => {
    const c = clusters.get(clusterId);
    if (!c) {
      return { ok: false, code: "NOT_FOUND", message: `cluster ${clusterId} not found` };
    }
    if (c.status === "decommissioned") {
      return {
        ok: false,
        code: "DECOMMISSIONED",
        message: `cluster ${clusterId} is decommissioned`,
      };
    }
    return { ok: true, value: c };
  };

  return {
    createCluster(input) {
      const name = input.name?.trim();
      if (!name) {
        return { ok: false, code: "INVALID", message: "cluster name required" };
      }
      const scaling: ScalingPolicy = {
        desiredNodes: input.scaling?.desiredNodes ?? 1,
        minNodes: input.scaling?.minNodes ?? 0,
        maxNodes: input.scaling?.maxNodes ?? 10,
      };
      const scaleErr = validateScaling(scaling);
      if (scaleErr) {
        return { ok: false, code: "INVALID", message: scaleErr };
      }
      const clusterId = input.clusterId?.trim() || idFactory();
      if (clusters.has(clusterId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `cluster ${clusterId} already exists`,
        };
      }
      const record: ClusterRecord = {
        clusterId,
        name,
        status: "ready",
        createdAt: new Date(now()).toISOString(),
        version: input.version?.trim() || "0.0.0",
        scaling,
        nodes: [],
      };
      clusters.set(clusterId, record);
      return { ok: true, value: cloneCluster(record) };
    },

    getCluster(clusterId) {
      const c = clusters.get(clusterId);
      return c ? cloneCluster(c) : undefined;
    },

    listClusters() {
      return [...clusters.values()].map(cloneCluster);
    },

    decommissionCluster(clusterId) {
      const c = clusters.get(clusterId);
      if (!c) {
        return { ok: false, code: "NOT_FOUND", message: `cluster ${clusterId} not found` };
      }
      if (c.status === "decommissioned") {
        return { ok: true, value: cloneCluster(c) };
      }
      c.status = "decommissioned";
      for (const plan of plans.values()) {
        if (plan.clusterId === clusterId && plan.status !== "completed") {
          plan.status = "aborted";
        }
      }
      return { ok: true, value: cloneCluster(c) };
    },

    registerNode(input) {
      const gate = requireMutable(input.clusterId);
      if (!gate.ok) return gate;
      const c = gate.value;
      const nodeId = input.nodeId?.trim();
      const address = input.address?.trim();
      if (!nodeId || !address) {
        return { ok: false, code: "INVALID", message: "nodeId and address required" };
      }
      if (c.nodes.some((n) => n.nodeId === nodeId)) {
        return {
          ok: false,
          code: "CONFLICT",
          message: `node ${nodeId} already registered`,
        };
      }
      const readyWorkers = c.nodes.filter(
        (n) => n.role === "worker" && (n.state === "ready" || n.state === "pending"),
      ).length;
      const role = input.role ?? "worker";
      const atCapacity =
        role === "worker" && readyWorkers >= c.scaling.maxNodes;
      if (atCapacity) {
        return {
          ok: false,
          code: "DENIED",
          message: `maxNodes ${c.scaling.maxNodes} reached`,
        };
      }
      const node: ControlPlaneNode = {
        nodeId,
        address,
        role,
        version: input.version?.trim() || c.version,
        state: "ready",
      };
      c.nodes.push(node);
      return { ok: true, value: { ...node } };
    },

    setScalingPolicy(clusterId, policy) {
      const gate = requireMutable(clusterId);
      if (!gate.ok) return gate;
      const scaleErr = validateScaling(policy);
      if (scaleErr) {
        return { ok: false, code: "INVALID", message: scaleErr };
      }
      const c = gate.value;
      if (c.status === "upgrading") {
        return {
          ok: false,
          code: "CONFLICT",
          message: "cannot change scaling during upgrade",
        };
      }
      c.scaling = { ...policy };
      return { ok: true, value: cloneCluster(c) };
    },

    reconcileScaling(clusterId) {
      const gate = requireMutable(clusterId);
      if (!gate.ok) return gate;
      const c = gate.value;
      const workers = c.nodes.filter(
        (n) => n.role === "worker" && n.state !== "retired",
      );
      const count = workers.length;
      const { desiredNodes, minNodes, maxNodes } = c.scaling;
      if (count < desiredNodes) {
        const add = Math.min(desiredNodes - count, maxNodes - count);
        if (add <= 0) {
          return { ok: true, value: { type: "noop" } };
        }
        return { ok: true, value: { type: "add", count: add } };
      }
      if (count > desiredNodes) {
        const removeCount = Math.min(count - desiredNodes, count - minNodes);
        if (removeCount <= 0) {
          return { ok: true, value: { type: "noop" } };
        }
        const removable = workers
          .filter((n) => n.state === "ready")
          .slice(-removeCount)
          .map((n) => n.nodeId);
        return { ok: true, value: { type: "remove", nodeIds: removable } };
      }
      return { ok: true, value: { type: "noop" } };
    },

    startRollingUpgrade(clusterId, toVersion, batchSize = 1) {
      const gate = requireMutable(clusterId);
      if (!gate.ok) return gate;
      const c = gate.value;
      const target = toVersion?.trim();
      if (!target) {
        return { ok: false, code: "INVALID", message: "toVersion required" };
      }
      if (!Number.isInteger(batchSize) || batchSize < 1) {
        return { ok: false, code: "INVALID", message: "batchSize must be ≥ 1" };
      }
      if (c.status === "upgrading") {
        return {
          ok: false,
          code: "CONFLICT",
          message: "upgrade already in progress",
        };
      }
      if (target === c.version && c.nodes.every((n) => n.version === target)) {
        return {
          ok: false,
          code: "INVALID",
          message: "cluster already at target version",
        };
      }
      const workers = c.nodes
        .filter((n) => n.role === "worker" && n.state === "ready")
        .map((n) => n.nodeId);
      const controls = c.nodes
        .filter((n) => n.role === "control" && n.state === "ready")
        .map((n) => n.nodeId);
      const nodeOrder = [...workers, ...controls];
      if (nodeOrder.length === 0) {
        return {
          ok: false,
          code: "INVALID",
          message: "no ready nodes to upgrade",
        };
      }
      const plan: UpgradePlan = {
        planId: idFactory(),
        clusterId,
        fromVersion: c.version,
        toVersion: target,
        batchSize,
        nodeOrder,
        cursor: 0,
        status: "pending",
      };
      plans.set(plan.planId, plan);
      c.status = "upgrading";
      return { ok: true, value: clonePlan(plan) };
    },

    advanceUpgrade(planId) {
      const plan = plans.get(planId);
      if (!plan) {
        return { ok: false, code: "NOT_FOUND", message: `plan ${planId} not found` };
      }
      if (plan.status === "completed" || plan.status === "aborted") {
        return { ok: false, code: "CONFLICT", message: `plan is ${plan.status}` };
      }
      const gate = requireMutable(plan.clusterId);
      if (!gate.ok) {
        plan.status = "aborted";
        return gate;
      }
      const c = gate.value;
      plan.status = "in_progress";

      const batch = plan.nodeOrder.slice(plan.cursor, plan.cursor + plan.batchSize);
      if (batch.length === 0) {
        plan.status = "completed";
        c.status = "ready";
        c.version = plan.toVersion;
        return { ok: true, value: clonePlan(plan) };
      }

      for (const nodeId of batch) {
        const node = c.nodes.find((n) => n.nodeId === nodeId);
        if (!node || node.state === "retired") continue;
        node.state = "draining";
        node.state = "upgrading";
        node.version = plan.toVersion;
        node.state = "ready";
      }

      plan.cursor += batch.length;
      if (plan.cursor >= plan.nodeOrder.length) {
        plan.status = "completed";
        c.status = "ready";
        c.version = plan.toVersion;
      }
      return { ok: true, value: clonePlan(plan) };
    },

    getUpgradePlan(planId) {
      const p = plans.get(planId);
      return p ? clonePlan(p) : undefined;
    },
  };
}
