---
label: RFC:FORENSIC-CONSOLE-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0029"
title: "Forensic Console — Local Evidence Chain for Workflow Runs"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: OS
milestone: "Product-ForensicConsole"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0029 — Forensic Console

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Milestone:** Forensic Console v1 (scaffold)
> **Created:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Ship ForensicConsole — append-only local evidence log
   for workflow run events (compile, place, heal, complete).
2. Default local-only. Export off unless customer sets endpoint.
3. No phone-home. Evidence stays in customer boundary by default.
4. Hash-chain entries for tamper-evidence (SHA-256).
```

---

## § 1 — Summary

Local forensic console that records structured evidence events with a
hash chain. Supports query by workflowId/runId and optional opt-in export.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | draft → accepted
  Directed with product hardening (options 1–3).
```

---

*Bell Corporate Labs · RFC-0029*
