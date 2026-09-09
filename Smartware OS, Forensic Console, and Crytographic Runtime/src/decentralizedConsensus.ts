/**
 * RFC-0027 Decentralized multi-organisation consensus research scaffold.
 * Quorum attestation without a privileged coordinator org. Ownerware secrets.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface OrgRegistration {
  orgId: string;
  /** Attestation secret held by the org — never logged. */
  attestationSecret: string;
}

export interface Attestation {
  orgId: string;
  workflowId: string;
  /** SHA-256 hex of payload. */
  payloadHash: string;
  /** HMAC-SHA256 over orgId|workflowId|payloadHash. */
  signature: string;
}

export interface DecentralizedCommit {
  workflowId: string;
  payloadHash: string;
  attestingOrgs: string[];
  quorum: number;
  at: string;
}

export type DecentralResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "INVALID" | "DENIED" | "NOT_FOUND" | "CONFLICT" | "QUORUM" | "MISMATCH";
      message: string;
    };

export interface DecentralizedOrgConsensusConfig {
  /** Distinct orgs required to commit. */
  quorum: number;
  now?: () => number;
}

export interface DecentralizedOrgConsensus {
  registerOrg(org: OrgRegistration): DecentralResult<{ orgId: string }>;
  listOrgs(): string[];
  attest(input: {
    orgId: string;
    workflowId: string;
    payload: Uint8Array | string;
  }): DecentralResult<Attestation>;
  /**
   * Commit when >= quorum distinct orgs attested the same
   * workflowId + payloadHash. No coordinator org.
   */
  tryCommit(workflowId: string): DecentralResult<DecentralizedCommit>;
  listCommits(): DecentralizedCommit[];
}

function toBytes(payload: Uint8Array | string): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

function hashPayload(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

function signAttestation(
  orgId: string,
  workflowId: string,
  payloadHash: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update([orgId, workflowId, payloadHash].join("|"))
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function createDecentralizedOrgConsensus(
  cfg: DecentralizedOrgConsensusConfig,
): DecentralizedOrgConsensus {
  if (!Number.isInteger(cfg.quorum) || cfg.quorum < 1) {
    throw new Error("quorum must be integer >= 1");
  }
  const now = cfg.now ?? (() => Date.now());
  const orgs = new Map<string, string>();
  /** workflowId → orgId → attestation */
  const pending = new Map<string, Map<string, Attestation>>();
  const commits: DecentralizedCommit[] = [];

  return {
    registerOrg(org) {
      const orgId = org.orgId?.trim();
      if (!orgId || !org.attestationSecret) {
        return {
          ok: false,
          code: "INVALID",
          message: "orgId and attestationSecret required",
        };
      }
      if (orgs.has(orgId)) {
        return { ok: false, code: "CONFLICT", message: `org ${orgId} exists` };
      }
      orgs.set(orgId, org.attestationSecret);
      return { ok: true, value: { orgId } };
    },

    listOrgs() {
      return [...orgs.keys()].sort();
    },

    attest(input) {
      const orgId = input.orgId?.trim();
      const workflowId = input.workflowId?.trim();
      if (!orgId || !workflowId) {
        return {
          ok: false,
          code: "INVALID",
          message: "orgId and workflowId required",
        };
      }
      const secret = orgs.get(orgId);
      if (!secret) {
        return { ok: false, code: "NOT_FOUND", message: `org ${orgId} not registered` };
      }
      const payloadHash = hashPayload(toBytes(input.payload));
      const signature = signAttestation(orgId, workflowId, payloadHash, secret);
      const att: Attestation = { orgId, workflowId, payloadHash, signature };
      let bucket = pending.get(workflowId);
      if (!bucket) {
        bucket = new Map();
        pending.set(workflowId, bucket);
      }
      bucket.set(orgId, att);
      return { ok: true, value: { ...att } };
    },

    tryCommit(workflowIdRaw) {
      const workflowId = workflowIdRaw?.trim();
      if (!workflowId) {
        return { ok: false, code: "INVALID", message: "workflowId required" };
      }
      const bucket = pending.get(workflowId);
      if (!bucket || bucket.size === 0) {
        return {
          ok: false,
          code: "QUORUM",
          message: "no attestations",
        };
      }

      /** Verify signatures and group by payloadHash. */
      const byHash = new Map<string, Attestation[]>();
      for (const att of bucket.values()) {
        const secret = orgs.get(att.orgId);
        if (!secret) {
          return {
            ok: false,
            code: "DENIED",
            message: `org ${att.orgId} no longer registered`,
          };
        }
        const expected = signAttestation(
          att.orgId,
          att.workflowId,
          att.payloadHash,
          secret,
        );
        if (!safeEqualHex(expected, att.signature)) {
          return {
            ok: false,
            code: "DENIED",
            message: `bad attestation from ${att.orgId}`,
          };
        }
        const list = byHash.get(att.payloadHash) ?? [];
        list.push(att);
        byHash.set(att.payloadHash, list);
      }

      /** Pick the hash with the most distinct orgs; require quorum. */
      let bestHash = "";
      let best: Attestation[] = [];
      for (const [hash, list] of byHash) {
        if (
          list.length > best.length ||
          (list.length === best.length && hash.localeCompare(bestHash) < 0)
        ) {
          best = list;
          bestHash = hash;
        }
      }
      if (best.length < cfg.quorum) {
        return {
          ok: false,
          code: "QUORUM",
          message: `have ${best.length} of ${cfg.quorum} required`,
        };
      }
      if (byHash.size > 1) {
        /** Competing hashes — fail closed unless one side already has quorum alone. */
        for (const [hash, list] of byHash) {
          if (hash !== bestHash && list.length > 0 && best.length < cfg.quorum) {
            return {
              ok: false,
              code: "MISMATCH",
              message: "competing payload hashes without quorum",
            };
          }
        }
      }

      const orgIds = [...new Set(best.map((a) => a.orgId))].sort();
      if (orgIds.length < cfg.quorum) {
        return {
          ok: false,
          code: "QUORUM",
          message: `distinct orgs ${orgIds.length} < ${cfg.quorum}`,
        };
      }

      const commit: DecentralizedCommit = {
        workflowId,
        payloadHash: bestHash,
        attestingOrgs: orgIds.slice(0, cfg.quorum),
        quorum: cfg.quorum,
        at: new Date(now()).toISOString(),
      };
      commits.push(commit);
      pending.delete(workflowId);
      return { ok: true, value: { ...commit, attestingOrgs: [...commit.attestingOrgs] } };
    },

    listCommits() {
      return commits.map((c) => ({
        ...c,
        attestingOrgs: [...c.attestingOrgs],
      }));
    },
  };
}
