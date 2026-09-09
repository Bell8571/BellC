/**
 * RFC-0013 Observability Layer — local-first traces, metrics, logs.
 * External export is opt-in; default is local-only (Authority-0 Phase 2).
 */

export type SpanStatus = "ok" | "error" | "unset";

export interface SpanRecord {
  spanId: string;
  name: string;
  traceId: string;
  parentSpanId?: string;
  startMs: number;
  endMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

export interface MetricPoint {
  name: string;
  kind: "counter" | "histogram";
  value: number;
  atMs: number;
  attributes: Record<string, string | number | boolean>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  message: string;
  atMs: number;
  attributes: Record<string, string | number | boolean>;
}

export interface ObservabilitySnapshot {
  spans: SpanRecord[];
  metrics: MetricPoint[];
  logs: LogRecord[];
  exportEnabled: boolean;
}

export interface ExportConfig {
  /** Default false — local-only. */
  enabled: boolean;
  /** Required when enabled. Customer-configured; never hardcoded SaaS. */
  endpoint?: string;
}

export type ObservabilityInitResult =
  | { ok: true; observability: Observability }
  | { ok: false; code: "EXPORT_ENDPOINT_REQUIRED"; message: string };

export interface SpanHandle {
  spanId: string;
  end(status?: SpanStatus, attributes?: Record<string, string | number | boolean>): void;
}

export interface Observability {
  startSpan(
    name: string,
    options?: {
      traceId?: string;
      parentSpanId?: string;
      attributes?: Record<string, string | number | boolean>;
      nowMs?: number;
    },
  ): SpanHandle;
  incr(
    name: string,
    value?: number,
    attributes?: Record<string, string | number | boolean>,
    nowMs?: number,
  ): void;
  observe(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
    nowMs?: number,
  ): void;
  log(
    level: LogLevel,
    message: string,
    attributes?: Record<string, string | number | boolean>,
    nowMs?: number,
  ): void;
  snapshot(): ObservabilitySnapshot;
  /**
   * Attempt export. Local-only mode returns { ok: true, exported: 0 }.
   * Opt-in mode posts JSON snapshot to endpoint (fetch); failures are returned, not thrown.
   */
  flushExport(): Promise<{ ok: true; exported: number } | { ok: false; message: string }>;
  exportEnabled(): boolean;
}

function ringPush<T>(buf: T[], item: T, max: number): void {
  buf.push(item);
  if (buf.length > max) {
    buf.splice(0, buf.length - max);
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createObservability(options?: {
  export?: ExportConfig;
  maxSpans?: number;
  maxMetrics?: number;
  maxLogs?: number;
  /** Injected for tests — default global fetch when exporting. */
  fetchImpl?: typeof fetch;
}): ObservabilityInitResult {
  const exportCfg: ExportConfig = options?.export ?? { enabled: false };
  if (exportCfg.enabled) {
    const endpoint = exportCfg.endpoint?.trim();
    if (!endpoint) {
      return {
        ok: false,
        code: "EXPORT_ENDPOINT_REQUIRED",
        message: "export.enabled requires a customer-configured endpoint (fail-closed)",
      };
    }
  }

  const maxSpans = options?.maxSpans ?? 2_000;
  const maxMetrics = options?.maxMetrics ?? 4_000;
  const maxLogs = options?.maxLogs ?? 2_000;
  const fetchImpl = options?.fetchImpl;

  const spans: SpanRecord[] = [];
  const metrics: MetricPoint[] = [];
  const logs: LogRecord[] = [];
  const open = new Map<string, SpanRecord>();

  const observability: Observability = {
    startSpan(name, opts = {}) {
      const spanId = newId();
      const rec: SpanRecord = {
        spanId,
        name,
        traceId: opts.traceId ?? newId(),
        parentSpanId: opts.parentSpanId,
        startMs: opts.nowMs ?? Date.now(),
        status: "unset",
        attributes: { ...(opts.attributes ?? {}) },
      };
      open.set(spanId, rec);
      ringPush(spans, rec, maxSpans);
      return {
        spanId,
        end(status = "ok", attributes) {
          const current = open.get(spanId) ?? rec;
          current.endMs = Date.now();
          current.status = status;
          if (attributes) {
            current.attributes = { ...current.attributes, ...attributes };
          }
          open.delete(spanId);
        },
      };
    },

    incr(name, value = 1, attributes = {}, nowMs = Date.now()) {
      ringPush(
        metrics,
        { name, kind: "counter", value, atMs: nowMs, attributes: { ...attributes } },
        maxMetrics,
      );
    },

    observe(name, value, attributes = {}, nowMs = Date.now()) {
      ringPush(
        metrics,
        { name, kind: "histogram", value, atMs: nowMs, attributes: { ...attributes } },
        maxMetrics,
      );
    },

    log(level, message, attributes = {}, nowMs = Date.now()) {
      ringPush(logs, { level, message, atMs: nowMs, attributes: { ...attributes } }, maxLogs);
    },

    snapshot() {
      return {
        spans: spans.map((s) => ({ ...s, attributes: { ...s.attributes } })),
        metrics: metrics.map((m) => ({ ...m, attributes: { ...m.attributes } })),
        logs: logs.map((l) => ({ ...l, attributes: { ...l.attributes } })),
        exportEnabled: exportCfg.enabled === true,
      };
    },

    async flushExport() {
      if (!exportCfg.enabled) {
        return { ok: true, exported: 0 };
      }
      const endpoint = exportCfg.endpoint!.trim();
      const body = JSON.stringify(observability.snapshot());
      const doFetch = fetchImpl ?? fetch;
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (!res.ok) {
          return { ok: false, message: `export HTTP ${res.status}` };
        }
        const snap = observability.snapshot();
        return {
          ok: true,
          exported: snap.spans.length + snap.metrics.length + snap.logs.length,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : "export failed",
        };
      }
    },

    exportEnabled: () => exportCfg.enabled === true,
  };

  return { ok: true, observability };
}
