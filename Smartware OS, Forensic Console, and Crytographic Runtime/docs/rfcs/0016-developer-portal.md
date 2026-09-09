---
label: RFC:DEVELOPER-PORTAL-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0016"
title: "Implement Developer Portal v1 — Local Start, Visual DAG Editor, Monitoring"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.3"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0016 — Developer Portal v1

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.3 — Developer Portal v1 (Dec 2028)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. `smartware portal start` MUST work locally (ownerware).
2. Default bind 127.0.0.1 only — refuse 0.0.0.0 unless explicitly opted in.
3. No phone-home, no CDN scripts that fetch remote assets by default.
4. Visual editor = local compile preview + graph frame; monitoring = local snapshots.
5. SOC 2 audit prep formally begins with this milestone (doc note only).
6. Do not scaffold M3.4 multi-region until directed.
```

---

## § 1 — Summary

Ship a **local Developer Portal**: HTTP server started by `smartware portal start`, serving a self-contained UI for workflow JSON editing, compile preview, DAG graph inspection, and simple run/monitor status — all without external telemetry.

---

## § 2 — Design

### 2.1 CLI

```
smartware portal start [--host 127.0.0.1] [--port 8787]
```

### 2.2 HTTP API (local)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Portal HTML (inline CSS/JS) |
| GET | `/api/health` | `{ ok, bind, version }` |
| POST | `/api/compile` | Compile workflow JSON body → CompileResult |
| POST | `/api/monitor` | Accept optional trace/status payload; return last snapshot |
| GET | `/api/monitor` | Last monitoring snapshot |

### 2.3 Security defaults

- Host default `127.0.0.1`
- Binding non-loopback requires `--allow-remote` (explicit)

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("next"). Linked to M3.3.
  Sign-off directed by the DRI; agent recorded the entry.
  SOC 2 Type II audit prep clock starts with M3.3.
```

---

*Bell Corporate Labs · RFC-0016 · M3.3*
