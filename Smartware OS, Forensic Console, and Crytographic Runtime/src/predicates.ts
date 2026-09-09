/**
 * RFC-0005 predicate language + control-flow parsing.
 * Pure evaluation. No eval / Function.
 */

export type JsonScalar = string | number | boolean | null;

export type Predicate =
  | { op: "exists"; path: string }
  | {
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      path: string;
      value: JsonScalar;
    }
  | { op: "and" | "or"; clauses: Predicate[] }
  | { op: "not"; clause: Predicate };

export type PredicatesResult =
  | { ok: true; value: boolean }
  | { ok: false; code: "PREDICATE_AMBIGUOUS"; reason: string };

export type ControlFlow =
  | {
      kind: "if";
      predicate: Predicate;
      then: string[];
      else: string[];
    }
  | {
      kind: "switch";
      path: string;
      cases: { equals: JsonScalar; then: string[] }[];
      default: string[];
    }
  | {
      kind: "loop";
      predicate: Predicate;
      body: string[];
      maxIterations: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPath(payload: Record<string, unknown> | undefined, path: string): unknown {
  if (!payload) return undefined;
  const trimmed = path.trim();
  if (trimmed === "") return undefined;
  const parts = trimmed.split(".");
  let cur: unknown = payload;
  for (const part of parts) {
    if (!isRecord(cur) || !(part in cur)) {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}

function cmpNumber(
  op: "gt" | "gte" | "lt" | "lte",
  left: unknown,
  right: JsonScalar,
): PredicatesResult {
  if (typeof left !== "number" || typeof right !== "number") {
    return { ok: false, code: "PREDICATE_AMBIGUOUS", reason: "numeric comparison requires numbers" };
  }
  if (op === "gt") return { ok: true, value: left > right };
  if (op === "gte") return { ok: true, value: left >= right };
  if (op === "lt") return { ok: true, value: left < right };
  return { ok: true, value: left <= right };
}

export function evaluatePredicate(
  predicate: Predicate,
  payload: Record<string, unknown> | undefined,
): PredicatesResult {
  switch (predicate.op) {
    case "and": {
      for (const clause of predicate.clauses) {
        const r = evaluatePredicate(clause, payload);
        if (!r.ok) return r;
        if (!r.value) return { ok: true, value: false };
      }
      // Empty AND defaults to false (deterministic).
      return { ok: true, value: predicate.clauses.length > 0 };
    }
    case "or": {
      if (predicate.clauses.length === 0) return { ok: true, value: false };
      for (const clause of predicate.clauses) {
        const r = evaluatePredicate(clause, payload);
        if (!r.ok) return r;
        if (r.value) return { ok: true, value: true };
      }
      return { ok: true, value: false };
    }
    case "not": {
      const r = evaluatePredicate(predicate.clause, payload);
      if (!r.ok) return r;
      return { ok: true, value: !r.value };
    }
    case "exists": {
      const found = readPath(payload, predicate.path);
      return { ok: true, value: found !== undefined };
    }
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const found = readPath(payload, predicate.path);
      if (found === undefined) {
        return { ok: false, code: "PREDICATE_AMBIGUOUS", reason: `missing path ${predicate.path}` };
      }
      if (predicate.op === "eq") return { ok: true, value: found === predicate.value };
      if (predicate.op === "neq") return { ok: true, value: found !== predicate.value };
      return cmpNumber(predicate.op, found, predicate.value);
    }
    default: {
      return { ok: false, code: "PREDICATE_AMBIGUOUS", reason: "unknown predicate op" };
    }
  }
}

export function isPredicate(raw: unknown): raw is Predicate {
  if (!isRecord(raw) || typeof raw.op !== "string") {
    return false;
  }
  const op = raw.op;
  if (op === "exists") {
    return typeof raw.path === "string";
  }
  if (op === "and" || op === "or") {
    return Array.isArray(raw.clauses) && raw.clauses.every(isPredicate);
  }
  if (op === "not") {
    return isPredicate(raw.clause);
  }
  if (op === "eq" || op === "neq" || op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const scalar = raw.value as JsonScalar;
    const scalarOk =
      scalar === null ||
      typeof scalar === "string" ||
      typeof scalar === "number" ||
      typeof scalar === "boolean";
    return typeof raw.path === "string" && scalarOk;
  }
  return false;
}

export function parseControl(raw: unknown): ControlFlow | undefined {
  if (!isRecord(raw) || typeof raw.kind !== "string") return undefined;
  if (raw.kind === "if") {
    if (!isPredicate(raw.predicate)) return undefined;
    if (!Array.isArray(raw.then) || !raw.then.every((x) => typeof x === "string")) return undefined;
    if (!Array.isArray(raw.else) || !raw.else.every((x) => typeof x === "string")) return undefined;
    return { kind: "if", predicate: raw.predicate, then: raw.then, else: raw.else };
  }
  if (raw.kind === "switch") {
    if (typeof raw.path !== "string") return undefined;
    if (!Array.isArray(raw.cases) || !Array.isArray(raw.default)) return undefined;
    const cases: { equals: JsonScalar; then: string[] }[] = [];
    for (const c of raw.cases) {
      if (!isRecord(c) || !Array.isArray(c.then)) return undefined;
      if (!c.then.every((x) => typeof x === "string")) return undefined;
      const eq = c.equals as JsonScalar;
      const eqOk = eq === null || typeof eq === "string" || typeof eq === "number" || typeof eq === "boolean";
      if (!eqOk) return undefined;
      cases.push({ equals: eq, then: c.then });
    }
    if (!raw.default.every((x: unknown) => typeof x === "string")) return undefined;
    return { kind: "switch", path: raw.path, cases, default: raw.default };
  }
  if (raw.kind === "loop") {
    if (!isPredicate(raw.predicate)) return undefined;
    if (!Array.isArray(raw.body) || !raw.body.every((x) => typeof x === "string")) return undefined;
    if (typeof raw.maxIterations !== "number") return undefined;
    return { kind: "loop", predicate: raw.predicate, body: raw.body, maxIterations: raw.maxIterations };
  }
  return undefined;
}

export function gatedNodeIds(control: ControlFlow): string[] {
  if (control.kind === "if") {
    return [...control.then, ...control.else];
  }
  if (control.kind === "switch") {
    return [...control.cases.flatMap((c) => c.then), ...control.default];
  }
  return [...control.body];
}

