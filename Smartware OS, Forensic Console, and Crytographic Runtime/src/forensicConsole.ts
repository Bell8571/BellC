/**
 * RFC-0029 Forensic Console.
 * Append-only local evidence chain. Export defaults OFF.
 */

import { createHash } from "node:crypto";

export type ForensicEventKind =
  | "compile"
  | "run_start"
  | "run_complete"
  | "place"
  | "heal"
  | "route"
  | "copilot"
  | "seal"
  | "custom";

export interface ForensicEventInput {
  kind: ForensicEventKind;
  workflowId: string;
  runId?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface ForensicEvidence {
  seq: number;
  at: string;
  kind: ForensicEventKind;
  workflowId: string;
  runId?: string;
  detail: Record<string, string | number | boolean | null>;
  /** SHA-256 of prevHash|canonical(body). */
  hash: string;
  prevHash: string;
}

export type ForensicResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "UNAVAILABLE";
      message: string;
    };

export interface ForensicConsoleConfig {
  now?: () => number;
  /** Default false. */
  exportEnabled?: boolean;
  exportEndpoint?: string;
  fetch?: typeof fetch;
}

export interface ForensicConsole {
  record(event: ForensicEventInput): ForensicResult<ForensicEvidence>;
  list(filter?: { workflowId?: string; runId?: string }): ForensicEvidence[];
  verifyChain(): ForensicResult<{ valid: true; length: number }>;
  exportEvidence(): Promise<ForensicResult<{ exported: number }>>;
}

const GENESIS = "0".repeat(64);

function canonicalBody(e: Omit<ForensicEvidence, "hash">): string {
  return [
    e.seq,
    e.at,
    e.kind,
    e.workflowId,
    e.runId ?? "",
    JSON.stringify(e.detail, Object.keys(e.detail).sort()),
    e.prevHash,
  ].join("|");
}

function hashEntry(prevHash: string, body: Omit<ForensicEvidence, "hash">): string {
  return createHash("sha256")
    .update(`${prevHash}|${canonicalBody(body)}`)
    .digest("hex");
}

export function createForensicConsole(
  cfg: ForensicConsoleConfig = {},
): ForensicConsole {
  const now = cfg.now ?? (() => Date.now());
  const exportEnabled = cfg.exportEnabled === true;
  const chain: ForensicEvidence[] = [];
  const fetchImpl = cfg.fetch ?? globalThis.fetch?.bind(globalThis);

  return {
    record(event) {
      const workflowId = event.workflowId?.trim();
      if (!workflowId) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      if (!event.kind) {
        return { ok: false, code: "INVALID", message: "kind required" };
      }
      const prevHash = chain.length === 0 ? GENESIS : chain[chain.length - 1]!.hash;
      const seq = chain.length + 1;
      const body: Omit<ForensicEvidence, "hash"> = {
        seq,
        at: new Date(now()).toISOString(),
        kind: event.kind,
        workflowId,
        runId: event.runId?.trim() || undefined,
        detail: event.detail ? { ...event.detail } : {},
        prevHash,
      };
      const hash = hashEntry(prevHash, body);
      const evidence: ForensicEvidence = { ...body, hash };
      chain.push(evidence);
      return {
        ok: true,
        value: {
          ...evidence,
          detail: { ...evidence.detail },
        },
      };
    },

    list(filter) {
      return chain
        .filter((e) => {
          if (filter?.workflowId && e.workflowId !== filter.workflowId) return false;
          if (filter?.runId && e.runId !== filter.runId) return false;
          return true;
        })
        .map((e) => ({ ...e, detail: { ...e.detail } }));
    },

    verifyChain() {
      let prev = GENESIS;
      for (const e of chain) {
        if (e.prevHash !== prev) {
          return {
            ok: false,
            code: "DENIED",
            message: `break at seq ${e.seq}: prevHash mismatch`,
          };
        }
        const { hash: _h, ...body } = e;
        const expected = hashEntry(prev, body);
        if (expected !== e.hash) {
          return {
            ok: false,
            code: "DENIED",
            message: `break at seq ${e.seq}: hash mismatch`,
          };
        }
        prev = e.hash;
      }
      return { ok: true, value: { valid: true, length: chain.length } };
    },

    async exportEvidence() {
      if (!exportEnabled) {
        return {
          ok: false,
          code: "DENIED",
          message: "export disabled (default)",
        };
      }
      const endpoint = cfg.exportEndpoint?.trim();
      if (!endpoint) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "exportEndpoint required when export enabled",
        };
      }
      if (!fetchImpl) {
        return { ok: false, code: "UNAVAILABLE", message: "fetch not available" };
      }
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1, evidence: chain }),
        });
        if (!res.ok) {
          return {
            ok: false,
            code: "UNAVAILABLE",
            message: `export HTTP ${res.status}`,
          };
        }
        return { ok: true, value: { exported: chain.length } };
      } catch (err) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: err instanceof Error ? err.message : "export failed",
        };
      }
    },
  };
}
