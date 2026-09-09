---
label: RFC:ENTERPRISE-SECURITY-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0018"
title: "Implement Enterprise Security — SSO/SAML, Audit Log, CMEK, Residency, SOC 2 Controls"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.5"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0018 — Enterprise Security + SOC 2 Type II Prep

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.5 — Enterprise Security + SOC 2 Type II (Jun 2029)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Customer-managed keys (CMEK) — Smartware never holds
   customer private key material; only opaque key references.
2. Audit logs default local; export opt-in with customer endpoint.
3. SSO/SAML uses customer-configured IdP metadata — no hardcoded IdP.
4. Data residency fail-closed when target region not allowlisted.
5. SOC 2 Type II: ship control checklist + evidence hooks; do NOT
   claim certification until human auditor signs off.
6. Do not scaffold M3.6 marketplace until directed.
```

---

## § 1 — Summary

Ship an **EnterpriseSecurity** facade: SAML assertion acceptance against customer IdP config, append-only local audit log, CMEK wrap/unwrap via customer key references, namespace data-residency allowlists, and a SOC 2 control register for Type II prep (started at M3.3).

---

## § 2 — Design Highlights

| Area | Rule |
|------|------|
| SSO | `configureIdp` + `acceptAssertion` → principalId |
| Audit | `record` / `query`; export only if enabled + endpoint |
| CMEK | `registerKeyRef` / `wrap` / `unwrap`; no raw key storage |
| Residency | `setResidency(namespace, regions)` / `assertResidency` |
| SOC 2 | Control IDs with `status: open \| in_progress \| evidenced` |

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("Next"). Linked to M3.5.
  Sign-off directed by the DRI; agent recorded the entry.
  SOC 2 Type II certification itself remains human-auditor owned.
```

---

*Bell Corporate Labs · RFC-0018 · M3.5*
