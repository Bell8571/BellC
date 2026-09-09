/**
 * RFC-0001 DAG Compiler Alpha — parse + compile.
 * Never throws. Cycle detection via Kahn's algorithm. Fail-closed.
 */

import { parse as parseYaml } from "yaml";
import type { NodeTypeRegistry, ConfigFieldType } from "./pluginApi.js";
import {
  gatedNodeIds,
  parseControl,
  type ControlFlow,
} from "./predicates.js";

export const COMPILER_VERSION = "1.1.0-alpha";
export const MAX_NODE_COUNT = 10_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 0,
  backoffMultiplier: 1,
};

export interface WorkflowDefinition {
  id: string;
  version: string;
  nodes: Record<string, NodeDefinition>;
  entrypoints: string[];
  triggers?: TriggerBinding[];
}

export interface TriggerBinding {
  id: string;
  kind: "webhook" | "queue";
  path?: string;
  channel?: string;
  action: { type: "START_WORKFLOW"; workflowId: string } | { type: "RESUME_NODE"; workflowId: string; nodeId: string };
  enabled?: boolean;
}

export interface NodeDefinition {
  id: string;
  type: string;
  dependsOn: string[];
  config: Record<string, unknown>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  control?: ControlFlow;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
}

export interface ResolvedExecutionGraph {
  workflowId: string;
  compiledAt: string;
  compilerVersion: string;
  executionOrder: string[][];
  nodes: Record<string, ResolvedNode>;
  metadata: GraphMetadata;
}

export interface ResolvedNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  dependsOn: string[];
  dependents: string[];
  timeout: number;
  retryPolicy: RetryPolicy;
  batchIndex: number;
  control?: ControlFlow;
}

export interface GraphMetadata {
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  parallelBatches: number;
  estimatedCriticalPathMs?: number;
}

export type CompilerError =
  | { code: "CYCLE_DETECTED"; cycle: string[]; message: string }
  | { code: "UNKNOWN_DEPENDENCY"; nodeId: string; ref: string }
  | { code: "INVALID_NODE_TYPE"; nodeId: string; type: string }
  | { code: "MISSING_ENTRYPOINT"; message: string }
  | { code: "DUPLICATE_NODE_ID"; nodeId: string }
  | { code: "SCHEMA_VIOLATION"; nodeId: string; field: string }
  | { code: "GRAPH_TOO_LARGE"; nodeCount: number; max: number }
  | { code: "INVALID_PREDICATE"; nodeId: string; message: string }
  | { code: "UNKNOWN_ARM_NODE"; nodeId: string; ref: string }
  | { code: "UNBOUNDED_LOOP"; nodeId: string }
  | { code: "LOOP_AS_CYCLE"; nodeId: string; message: string }
  | { code: "EMPTY_SWITCH"; nodeId: string };

export type CompileResult =
  | { ok: true; graph: ResolvedExecutionGraph }
  | { ok: false; errors: CompilerError[] };

export type ParseResult =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; errors: CompilerError[] };

function jsonTypeOf(value: unknown): ConfigFieldType | "array" | "null" | "undefined" {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return t;
  }
  if (t === "object") {
    return "object";
  }
  return "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return undefined;
    }
    out.push(item);
  }
  return out;
}

function normalizeRetry(raw: unknown): RetryPolicy | undefined {
  if (raw === undefined) {
    return DEFAULT_RETRY_POLICY;
  }
  if (!isRecord(raw)) {
    return undefined;
  }
  const maxAttempts = raw["maxAttempts"];
  const backoffMs = raw["backoffMs"];
  const backoffMultiplier = raw["backoffMultiplier"];
  if (
    typeof maxAttempts !== "number" ||
    typeof backoffMs !== "number" ||
    typeof backoffMultiplier !== "number"
  ) {
    return undefined;
  }
  return { maxAttempts, backoffMs, backoffMultiplier };
}

function coerceDefinition(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "source" }] };
  }
  const id = raw["id"];
  const version = raw["version"];
  const nodesRaw = raw["nodes"];
  const entrypointsRaw = raw["entrypoints"];
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "id" }] };
  }
  if (typeof version !== "string") {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "version" }] };
  }
  if (!isRecord(nodesRaw)) {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "nodes" }] };
  }
  const entrypoints = asStringArray(entrypointsRaw);
  if (entrypoints === undefined) {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "entrypoints" }] };
  }

  const nodes: Record<string, NodeDefinition> = {};
  const errors: CompilerError[] = [];
  for (const [key, nodeRaw] of Object.entries(nodesRaw)) {
    if (!isRecord(nodeRaw)) {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "nodes" });
      continue;
    }
    const nodeId = typeof nodeRaw["id"] === "string" ? nodeRaw["id"] : key;
    const type = nodeRaw["type"];
    const dependsOn = asStringArray(nodeRaw["dependsOn"] ?? []);
    const config = nodeRaw["config"];
    if (typeof type !== "string") {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "type" });
      continue;
    }
    if (dependsOn === undefined) {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "dependsOn" });
      continue;
    }
    if (!isRecord(config) && config !== undefined) {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "config" });
      continue;
    }
    const timeout = nodeRaw["timeout"];
    if (timeout !== undefined && typeof timeout !== "number") {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "timeout" });
      continue;
    }
    const retryPolicy = normalizeRetry(nodeRaw["retryPolicy"]);
    if (retryPolicy === undefined) {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "retryPolicy" });
      continue;
    }
    let control: ControlFlow | undefined;
    if (nodeRaw["control"] !== undefined) {
      control = parseControl(nodeRaw["control"]);
      if (control === undefined) {
        errors.push({ code: "INVALID_PREDICATE", nodeId: key, message: "invalid control block" });
        continue;
      }
    }
    nodes[key] = {
      id: nodeId,
      type,
      dependsOn,
      config: isRecord(config) ? config : {},
      timeout: typeof timeout === "number" ? timeout : undefined,
      retryPolicy,
      control,
    };
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, definition: { id, version, nodes, entrypoints } };
}

export function parse(source: string, format: "json" | "yaml"): ParseResult {
  try {
    let raw: unknown;
    if (format === "json") {
      raw = JSON.parse(source) as unknown;
    } else {
      raw = parseYaml(source) as unknown;
    }
    return coerceDefinition(raw);
  } catch {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "source" }] };
  }
}

function extractCycle(
  remaining: Set<string>,
  dependents: Map<string, string[]>,
): string[] {
  const color = new Map<string, 0 | 1 | 2>();
  const parent = new Map<string, string>();
  let found: string[] | undefined;

  const dfs = (node: string): boolean => {
    color.set(node, 1);
    for (const next of dependents.get(node) ?? []) {
      if (!remaining.has(next)) {
        continue;
      }
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const cycle: string[] = [next];
        let walk = node;
        cycle.unshift(walk);
        while (walk !== next && parent.has(walk)) {
          const p = parent.get(walk);
          if (p === undefined) {
            break;
          }
          walk = p;
          cycle.unshift(walk);
        }
        found = cycle;
        return true;
      }
      if (state === 0) {
        parent.set(next, node);
        if (dfs(next)) {
          return true;
        }
      }
    }
    color.set(node, 2);
    return false;
  };

  for (const start of [...remaining].sort()) {
    if ((color.get(start) ?? 0) === 0 && dfs(start) && found !== undefined) {
      return found;
    }
  }
  return [...remaining].sort();
}

export function compile(definition: WorkflowDefinition, registry: NodeTypeRegistry): CompileResult {
  try {
    return compileInner(definition, registry);
  } catch {
    return { ok: false, errors: [{ code: "SCHEMA_VIOLATION", nodeId: "", field: "internal" }] };
  }
}

function compileInner(definition: WorkflowDefinition, registry: NodeTypeRegistry): CompileResult {
  const errors: CompilerError[] = [];
  const keys = Object.keys(definition.nodes);
  const nodeCount = keys.length;

  if (nodeCount > MAX_NODE_COUNT) {
    return { ok: false, errors: [{ code: "GRAPH_TOO_LARGE", nodeCount, max: MAX_NODE_COUNT }] };
  }

  const seenIds = new Map<string, string>();
  for (const key of keys) {
    const node = definition.nodes[key];
    if (!node) {
      continue;
    }
    if (node.id !== key) {
      errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field: "id" });
    }
    const prior = seenIds.get(node.id);
    if (prior !== undefined && prior !== key) {
      errors.push({ code: "DUPLICATE_NODE_ID", nodeId: node.id });
    }
    seenIds.set(node.id, key);
  }

  for (const ep of definition.entrypoints) {
    if (!(ep in definition.nodes)) {
      errors.push({ code: "UNKNOWN_DEPENDENCY", nodeId: "", ref: ep });
    }
  }

  const dependents = new Map<string, string[]>();
  for (const key of keys) {
    dependents.set(key, []);
  }

  let edgeCount = 0;
  for (const key of keys) {
    const node = definition.nodes[key];
    if (!node) {
      continue;
    }
    const registered = registry.getNodeType(node.type);
    if (!registered) {
      errors.push({ code: "INVALID_NODE_TYPE", nodeId: key, type: node.type });
    } else {
      for (const [field, schema] of Object.entries(registered.configSchema.fields)) {
        const value = node.config[field];
        if (schema.required && value === undefined) {
          errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field });
          continue;
        }
        if (value !== undefined) {
          const actual = jsonTypeOf(value);
          if (actual !== schema.type) {
            errors.push({ code: "SCHEMA_VIOLATION", nodeId: key, field });
          }
        }
      }
    }

    const depSet = new Set<string>();
    for (const ref of node.dependsOn) {
      if (!(ref in definition.nodes)) {
        errors.push({ code: "UNKNOWN_DEPENDENCY", nodeId: key, ref });
        continue;
      }
      if (depSet.has(ref)) {
        continue;
      }
      depSet.add(ref);
      edgeCount += 1;
      const list = dependents.get(ref);
      if (list) {
        list.push(key);
      }
    }

    if (node.control) {
      const control = node.control;
      if (control.kind === "loop") {
        if (!Number.isFinite(control.maxIterations) || control.maxIterations < 1) {
          errors.push({ code: "UNBOUNDED_LOOP", nodeId: key });
        }
        for (const ref of control.body) {
          if (!(ref in definition.nodes)) {
            errors.push({ code: "UNKNOWN_ARM_NODE", nodeId: key, ref });
          }
        }
        if (control.body.some((b) => node.dependsOn.includes(b))) {
          errors.push({
            code: "LOOP_AS_CYCLE",
            nodeId: key,
            message: "loop node must not depend on its body (no compiled back-edge)",
          });
        }
      } else if (control.kind === "if") {
        for (const ref of gatedNodeIds(control)) {
          if (!(ref in definition.nodes)) {
            errors.push({ code: "UNKNOWN_ARM_NODE", nodeId: key, ref });
          }
        }
      } else {
        if (control.cases.length === 0 && control.default.length === 0) {
          errors.push({ code: "EMPTY_SWITCH", nodeId: key });
        }
        for (const ref of gatedNodeIds(control)) {
          if (!(ref in definition.nodes)) {
            errors.push({ code: "UNKNOWN_ARM_NODE", nodeId: key, ref });
          }
        }
      }
    }
  }

  const roots = keys.filter((key) => {
    const node = definition.nodes[key];
    return node !== undefined && node.dependsOn.length === 0;
  });
  if (roots.length === 0) {
    errors.push({ code: "MISSING_ENTRYPOINT", message: "at least one node must have an empty dependsOn" });
  }

  const inDegree = new Map<string, number>();
  for (const key of keys) {
    const node = definition.nodes[key];
    const uniqueValid = new Set(
      (node?.dependsOn ?? []).filter((d) => d in definition.nodes),
    );
    inDegree.set(key, uniqueValid.size);
  }

  const remaining = new Set(keys);
  const executionOrder: string[][] = [];
  let ready = keys
    .filter((k) => inDegree.get(k) === 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  while (ready.length > 0) {
    executionOrder.push([...ready]);
    const next: string[] = [];
    for (const id of ready) {
      remaining.delete(id);
      const downs = dependents.get(id) ?? [];
      downs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const dep of downs) {
        const deg = inDegree.get(dep);
        if (deg === undefined) {
          continue;
        }
        const updated = deg - 1;
        inDegree.set(dep, updated);
        if (updated === 0) {
          next.push(dep);
        }
      }
    }
    ready = [...new Set(next)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  if (remaining.size > 0) {
    const cycle = extractCycle(remaining, dependents);
    errors.push({
      code: "CYCLE_DETECTED",
      cycle,
      message: `cycle involving ${cycle.join(" -> ")}`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const batchIndex = new Map<string, number>();
  executionOrder.forEach((batch, i) => {
    for (const id of batch) {
      batchIndex.set(id, i);
    }
  });

  const resolved: Record<string, ResolvedNode> = {};
  for (const key of keys) {
    const node = definition.nodes[key];
    if (!node) {
      continue;
    }
    const deps = dependents.get(key) ?? [];
    deps.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    resolved[key] = {
      id: key,
      type: node.type,
      config: { ...node.config },
      dependsOn: [...node.dependsOn],
      dependents: [...deps],
      timeout: node.timeout ?? DEFAULT_TIMEOUT_MS,
      retryPolicy: node.retryPolicy ?? DEFAULT_RETRY_POLICY,
      batchIndex: batchIndex.get(key) ?? 0,
      control: node.control,
    };
  }

  const longest = new Map<string, number>();
  const longestMs = new Map<string, number>();
  for (const batch of executionOrder) {
    for (const id of batch) {
      const node = resolved[id];
      if (!node) {
        continue;
      }
      let depth = 1;
      let pathMs = node.timeout;
      for (const pred of node.dependsOn) {
        const pd = longest.get(pred) ?? 1;
        const pms = longestMs.get(pred) ?? 0;
        if (pd + 1 > depth) {
          depth = pd + 1;
        }
        if (pms + node.timeout > pathMs) {
          pathMs = pms + node.timeout;
        }
      }
      longest.set(id, depth);
      longestMs.set(id, pathMs);
    }
  }

  let maxDepth = 0;
  let estimatedCriticalPathMs = 0;
  for (const id of keys) {
    const d = longest.get(id) ?? 0;
    const ms = longestMs.get(id) ?? 0;
    if (d > maxDepth) {
      maxDepth = d;
    }
    if (ms > estimatedCriticalPathMs) {
      estimatedCriticalPathMs = ms;
    }
  }

  const graph: ResolvedExecutionGraph = {
    workflowId: definition.id,
    compiledAt: new Date().toISOString(),
    compilerVersion: COMPILER_VERSION,
    executionOrder,
    nodes: resolved,
    metadata: {
      nodeCount,
      edgeCount,
      maxDepth,
      parallelBatches: executionOrder.length,
      estimatedCriticalPathMs,
    },
  };

  return { ok: true, graph };
}
