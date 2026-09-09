/**
 * RFC-0025 Formal Verification research scaffold.
 * Machine-checkable DAG + consensus invariants. Local only.
 */

export type VerifyStatus = "proven" | "violated" | "invalid";

export interface DagNodeSpec {
  id: string;
  dependsOn: string[];
  batchIndex: number;
}

export interface CompiledDagCert {
  nodes: DagNodeSpec[];
}

export interface ConsensusTraceEvent {
  term: number;
  leaderId: string;
  /** Monotonic log index after this commit (1-based). */
  logIndex: number;
  /** True if this event is a committed write. */
  committed: boolean;
  /** Alive voter count at election/commit. */
  aliveVoters: number;
  /** Cluster size N (majority = floor(N/2)+1). */
  clusterSize: number;
}

export interface InvariantResult {
  name: string;
  status: VerifyStatus;
  detail: string;
}

export interface VerificationCertificate {
  ok: boolean;
  results: InvariantResult[];
  at: string;
}

export type FormalResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "INVALID"; message: string };

export interface FormalVerifier {
  verifyDag(cert: CompiledDagCert): FormalResult<VerificationCertificate>;
  verifyConsensusTrace(
    events: ConsensusTraceEvent[],
  ): FormalResult<VerificationCertificate>;
}

export interface FormalVerifierConfig {
  now?: () => number;
}

export function createFormalVerifier(
  cfg: FormalVerifierConfig = {},
): FormalVerifier {
  const now = cfg.now ?? (() => Date.now());

  function stamp(results: InvariantResult[]): VerificationCertificate {
    const ok = results.every((r) => r.status === "proven");
    return {
      ok,
      results,
      at: new Date(now()).toISOString(),
    };
  }

  return {
    verifyDag(cert) {
      if (!cert || !Array.isArray(cert.nodes)) {
        return { ok: false, code: "INVALID", message: "nodes array required" };
      }
      const results: InvariantResult[] = [];
      const ids = new Set<string>();
      for (const n of cert.nodes) {
        if (!n.id?.trim()) {
          return { ok: false, code: "INVALID", message: "empty node id" };
        }
        if (ids.has(n.id)) {
          results.push({
            name: "unique-node-ids",
            status: "violated",
            detail: `duplicate id ${n.id}`,
          });
        }
        ids.add(n.id);
      }
      if (!results.some((r) => r.name === "unique-node-ids")) {
        results.push({
          name: "unique-node-ids",
          status: "proven",
          detail: "all node ids unique",
        });
      }

      /** Topological: every dependsOn must exist and have strictly lower batchIndex. */
      let topoOk = true;
      let topoDetail = "dependencies respect batch order";
      const byId = new Map(cert.nodes.map((n) => [n.id, n]));
      for (const n of cert.nodes) {
        for (const dep of n.dependsOn ?? []) {
          const d = byId.get(dep);
          if (!d) {
            topoOk = false;
            topoDetail = `missing dependency ${dep} for ${n.id}`;
            break;
          }
          if (!(d.batchIndex < n.batchIndex)) {
            topoOk = false;
            topoDetail = `${dep} batch ${d.batchIndex} not < ${n.id} batch ${n.batchIndex}`;
            break;
          }
        }
        if (!topoOk) break;
      }
      results.push({
        name: "topo-batch-order",
        status: topoOk ? "proven" : "violated",
        detail: topoDetail,
      });

      /** Batch exclusivity: same batchIndex nodes must not depend on each other. */
      let batchOk = true;
      let batchDetail = "no intra-batch edges";
      for (const n of cert.nodes) {
        for (const dep of n.dependsOn ?? []) {
          const d = byId.get(dep);
          if (d && d.batchIndex === n.batchIndex) {
            batchOk = false;
            batchDetail = `intra-batch edge ${dep} → ${n.id}`;
            break;
          }
        }
        if (!batchOk) break;
      }
      results.push({
        name: "batch-exclusivity",
        status: batchOk ? "proven" : "violated",
        detail: batchDetail,
      });

      return { ok: true, value: stamp(results) };
    },

    verifyConsensusTrace(events) {
      if (!Array.isArray(events)) {
        return { ok: false, code: "INVALID", message: "events array required" };
      }
      const results: InvariantResult[] = [];

      /** Single leader per term among committed events. */
      const leadersByTerm = new Map<number, string>();
      let leaderOk = true;
      let leaderDetail = "at most one leader per term";
      for (const e of events) {
        if (!e.committed) continue;
        const prev = leadersByTerm.get(e.term);
        if (prev && prev !== e.leaderId) {
          leaderOk = false;
          leaderDetail = `term ${e.term} has leaders ${prev} and ${e.leaderId}`;
          break;
        }
        leadersByTerm.set(e.term, e.leaderId);
      }
      results.push({
        name: "single-leader-per-term",
        status: leaderOk ? "proven" : "violated",
        detail: leaderDetail,
      });

      /** Majority: aliveVoters >= floor(N/2)+1 for committed events. */
      let majorityOk = true;
      let majorityDetail = "commits have majority";
      for (const e of events) {
        if (!e.committed) continue;
        const need = Math.floor(e.clusterSize / 2) + 1;
        if (e.aliveVoters < need) {
          majorityOk = false;
          majorityDetail = `logIndex ${e.logIndex}: alive ${e.aliveVoters} < majority ${need}`;
          break;
        }
      }
      results.push({
        name: "majority-commit",
        status: majorityOk ? "proven" : "violated",
        detail: majorityDetail,
      });

      /** Monotonic log indices among committed events. */
      let monoOk = true;
      let monoDetail = "committed logIndex strictly increasing";
      let last = 0;
      for (const e of events) {
        if (!e.committed) continue;
        if (!(e.logIndex > last)) {
          monoOk = false;
          monoDetail = `logIndex ${e.logIndex} not > ${last}`;
          break;
        }
        last = e.logIndex;
      }
      results.push({
        name: "monotonic-log",
        status: monoOk ? "proven" : "violated",
        detail: monoDetail,
      });

      return { ok: true, value: stamp(results) };
    },
  };
}
