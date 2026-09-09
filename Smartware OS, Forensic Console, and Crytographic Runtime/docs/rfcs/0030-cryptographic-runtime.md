---
label: RFC:CRYPTOGRAPHIC-RUNTIME-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0030"
title: "Cryptographic Runtime — Customer-Held Keys for Sign/Verify/Wrap"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: OS
milestone: "Product-CryptographicRuntime"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0030 — Cryptographic Runtime

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Milestone:** Cryptographic Runtime v1 (scaffold)
> **Created:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Ship CryptographicRuntime — HMAC sign/verify and
   opaque key-handle wrap/unwrap for DAG payloads.
2. Ownerware: customer supplies key material; never log secrets.
3. No Smartware-hosted KMS by default. No phone-home.
4. Fail-closed on missing keys / bad signatures.
```

---

## § 1 — Summary

Local cryptographic helpers for signing workflow manifests and wrapping
secrets under customer-held key handles. Complements enterprise CMEK
with a runtime-facing API used by demos and forensic evidence sealing.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | draft → accepted
  Directed with product hardening (options 1–3).
```

---

*Bell Corporate Labs · RFC-0030*
