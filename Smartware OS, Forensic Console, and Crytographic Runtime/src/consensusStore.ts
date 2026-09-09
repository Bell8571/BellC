/**
 * RFC-0011 Distributed State Store — Raft-inspired replicated log + KV.
 *
 * INVARIANTS (formally reviewable — do not weaken without a new RFC):
 *   I1  At most one leader per term within a cluster view.
 *   I2  Committed log slots are immutable (index, term, command).
 *   I3  KV reads reflect only committed entries (commitIndex / lastApplied).
 *   I4  Mutations accepted only by the current leader; commit needs quorum.
 *   I5  Leader election requires majority votes for a term.
 *
 * Alpha: in-process multi-node simulator. No external coordination service.
 */

export type RaftRole = "follower" | "candidate" | "leader";

export type LogCommand =
  | { type: "set"; key: string; value: string }
  | { type: "del"; key: string };

export interface LogEntry {
  index: number; // 1-based
  term: number;
  command: LogCommand;
}

export type KvResult =
  | { ok: true; index: number }
  | {
      ok: false;
      code: "NOT_LEADER" | "NO_QUORUM";
      message: string;
      leaderHint?: string;
    };

export interface ConsensusNode {
  readonly id: string;
  role(): RaftRole;
  term(): number;
  commitIndex(): number;
  get(key: string): string | undefined;
  set(key: string, value: string): KvResult;
  del(key: string): KvResult;
  requestVote(
    term: number,
    candidateId: string,
    lastLogIndex: number,
    lastLogTerm: number,
  ): { voteGranted: boolean; term: number };
  appendEntries(
    term: number,
    leaderId: string,
    prevLogIndex: number,
    prevLogTerm: number,
    entries: LogEntry[],
    leaderCommit: number,
  ): { success: boolean; term: number };
  /** @internal test helpers */
  _debugLog(): LogEntry[];
  _becomeFollower(term: number): void;
  _forceLeader(term: number, leaderId: string): void;
  _appendAsLeader(command: LogCommand): number;
  _setCommitIndex(index: number): void;
  _applyCommitted(): void;
  _lastLogMeta(): { index: number; term: number };
  _setVotedFor(id: string | undefined): void;
  _setRole(role: RaftRole): void;
  _setTerm(term: number): void;
  _setLeaderId(id: string | undefined): void;
  _leaderId(): string | undefined;
  _matchIndex(): number;
}

export interface ConsensusCluster {
  nodes(): ConsensusNode[];
  node(id: string): ConsensusNode | undefined;
  elect(preferredCandidate?: string): string | undefined;
  /** Replicate leader log to followers and advance commit under quorum (I4). */
  replicate(): boolean;
  leaderId(): string | undefined;
}

function majority(n: number): number {
  return Math.floor(n / 2) + 1;
}

function createNode(id: string): ConsensusNode {
  let role: RaftRole = "follower";
  let currentTerm = 0;
  let votedFor: string | undefined;
  let leaderId: string | undefined;
  const log: LogEntry[] = [];
  let commitIndex = 0;
  let lastApplied = 0;
  const kv = new Map<string, string>();

  const lastLogMeta = (): { index: number; term: number } => {
    const e = log[log.length - 1];
    return e ? { index: e.index, term: e.term } : { index: 0, term: 0 };
  };

  const applyCommitted = (): void => {
    while (lastApplied < commitIndex) {
      lastApplied += 1;
      const entry = log[lastApplied - 1];
      // I2: committed entry must exist at this index.
      if (!entry || entry.index !== lastApplied) {
        throw new Error(`I2 violated: missing committed entry at ${lastApplied}`);
      }
      if (entry.command.type === "set") {
        kv.set(entry.command.key, entry.command.value);
      } else {
        kv.delete(entry.command.key);
      }
    }
  };

  const appendAsLeader = (command: LogCommand): number => {
    const index = log.length + 1;
    log.push({ index, term: currentTerm, command });
    return index;
  };

  return {
    id,
    role: () => role,
    term: () => currentTerm,
    commitIndex: () => commitIndex,

    get(key) {
      // I3: only committed/applied state is readable.
      return kv.get(key);
    },

    set(key, value) {
      // I4: leader-only writes.
      if (role !== "leader") {
        return {
          ok: false,
          code: "NOT_LEADER",
          message: "writes must go to the leader",
          leaderHint: leaderId,
        };
      }
      const index = appendAsLeader({ type: "set", key, value });
      return { ok: true, index };
    },

    del(key) {
      if (role !== "leader") {
        return {
          ok: false,
          code: "NOT_LEADER",
          message: "writes must go to the leader",
          leaderHint: leaderId,
        };
      }
      const index = appendAsLeader({ type: "del", key });
      return { ok: true, index };
    },

    requestVote(term, candidateId, lastLogIndex, lastLogTerm) {
      if (term < currentTerm) {
        return { voteGranted: false, term: currentTerm };
      }
      if (term > currentTerm) {
        currentTerm = term;
        role = "follower";
        votedFor = undefined;
        leaderId = undefined;
      }
      const last = lastLogMeta();
      const logOk =
        lastLogTerm > last.term || (lastLogTerm === last.term && lastLogIndex >= last.index);
      // I5: at most one vote per term.
      if (logOk && (votedFor === undefined || votedFor === candidateId)) {
        votedFor = candidateId;
        return { voteGranted: true, term: currentTerm };
      }
      return { voteGranted: false, term: currentTerm };
    },

    appendEntries(term, lid, prevLogIndex, prevLogTerm, entries, leaderCommit) {
      if (term < currentTerm) {
        return { success: false, term: currentTerm };
      }
      if (term > currentTerm) {
        currentTerm = term;
        votedFor = undefined;
      }
      // I1: accept leader for this term.
      role = "follower";
      leaderId = lid;
      currentTerm = term;

      if (prevLogIndex > 0) {
        const prev = log[prevLogIndex - 1];
        if (!prev || prev.term !== prevLogTerm) {
          return { success: false, term: currentTerm };
        }
      }

      for (const entry of entries) {
        const existing = log[entry.index - 1];
        if (existing) {
          if (existing.term !== entry.term) {
            // I2: never overwrite committed entries.
            if (entry.index <= commitIndex) {
              throw new Error(`I2 violated: refusing overwrite of committed index ${entry.index}`);
            }
            log.length = entry.index - 1;
            log.push(entry);
          }
        } else {
          if (entry.index !== log.length + 1) {
            return { success: false, term: currentTerm };
          }
          log.push(entry);
        }
      }

      if (leaderCommit > commitIndex) {
        commitIndex = Math.min(leaderCommit, log.length);
        applyCommitted();
      }
      return { success: true, term: currentTerm };
    },

    _debugLog: () => log.map((e) => ({ ...e, command: { ...e.command } })),
    _becomeFollower(term) {
      currentTerm = term;
      role = "follower";
      votedFor = undefined;
      leaderId = undefined;
    },
    _forceLeader(term, lid) {
      currentTerm = term;
      role = lid === id ? "leader" : "follower";
      leaderId = lid;
    },
    _appendAsLeader: appendAsLeader,
    _setCommitIndex(index) {
      commitIndex = index;
    },
    _applyCommitted: applyCommitted,
    _lastLogMeta: lastLogMeta,
    _setVotedFor(v) {
      votedFor = v;
    },
    _setRole(r) {
      role = r;
    },
    _setTerm(t) {
      currentTerm = t;
    },
    _setLeaderId(lid) {
      leaderId = lid;
    },
    _leaderId: () => leaderId,
    _matchIndex: () => log.length,
  };
}

export function createConsensusCluster(nodeIds: string[]): ConsensusCluster {
  if (nodeIds.length === 0) {
    throw new Error("consensus cluster requires at least one node");
  }
  const uniq = [...new Set(nodeIds)].sort((a, b) => a.localeCompare(b));
  const nodesMap = new Map<string, ConsensusNode>();
  for (const id of uniq) {
    nodesMap.set(id, createNode(id));
  }

  let currentLeader: string | undefined;

  const all = (): ConsensusNode[] => [...nodesMap.values()];

  return {
    nodes: () => all(),
    node: (id) => nodesMap.get(id),
    leaderId: () => currentLeader,

    elect(preferredCandidate?: string): string | undefined {
      const n = all();
      const need = majority(n.length);
      const candidate =
        n.find((x) => x.id === preferredCandidate) ?? n[0];
      if (!candidate) return undefined;

      const term = Math.max(...n.map((x) => x.term()), 0) + 1;
      for (const node of n) {
        node._becomeFollower(Math.max(node.term(), term - 1));
        node._setTerm(term);
        node._setVotedFor(undefined);
        node._setLeaderId(undefined);
        node._setRole("follower");
      }

      candidate._setRole("candidate");
      candidate._setVotedFor(candidate.id);
      const meta = candidate._lastLogMeta();

      let votes = 1;
      for (const peer of n) {
        if (peer.id === candidate.id) continue;
        const res = peer.requestVote(term, candidate.id, meta.index, meta.term);
        if (res.term > term) {
          currentLeader = undefined;
          return undefined;
        }
        if (res.voteGranted) votes += 1;
      }

      // I5: majority required.
      if (votes < need) {
        candidate._setRole("follower");
        currentLeader = undefined;
        return undefined;
      }

      // I1: single leader for this term in this view.
      for (const peer of n) {
        peer._forceLeader(term, candidate.id);
      }
      currentLeader = candidate.id;
      return candidate.id;
    },

    replicate(): boolean {
      if (!currentLeader) return false;
      const leader = nodesMap.get(currentLeader);
      if (!leader || leader.role() !== "leader") return false;

      const n = all();
      const need = majority(n.length);
      let matched = 1;

      for (const peer of n) {
        if (peer.id === leader.id) continue;
        const peerLen = peer._matchIndex();
        const prevLogIndex = peerLen;
        const prevLogTerm =
          prevLogIndex === 0 ? 0 : (leader._debugLog()[prevLogIndex - 1]?.term ?? 0);
        const suffix = leader._debugLog().slice(peerLen);
        const res = peer.appendEntries(
          leader.term(),
          leader.id,
          prevLogIndex,
          prevLogTerm,
          suffix,
          leader.commitIndex(),
        );
        if (res.term > leader.term()) {
          leader._setRole("follower");
          currentLeader = undefined;
          return false;
        }
        if (res.success) matched += 1;
      }

      // I4: commit only with quorum replication.
      if (matched < need) {
        return false;
      }

      const leaderLen = leader._matchIndex();
      if (leaderLen > leader.commitIndex()) {
        leader._setCommitIndex(leaderLen);
        leader._applyCommitted();
        for (const peer of n) {
          if (peer.id === leader.id) continue;
          peer.appendEntries(
            leader.term(),
            leader.id,
            peer._matchIndex(),
            peer._matchIndex() === 0 ? 0 : peer._debugLog()[peer._matchIndex() - 1]!.term,
            [],
            leader.commitIndex(),
          );
        }
      }
      return true;
    },
  };
}
