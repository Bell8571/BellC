---
label: RFC:MARKETPLACE-REGISTRY-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0019"
title: "Implement Marketplace Launch — Signed Packages, Partner Onboarding, Mirrorable Registry"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: 3
milestone: "M3.6"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0019 — Marketplace Launch

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** 3 — Smartware Cloud
> **Milestone:** M3.6 — Marketplace Launch (Aug 2029)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Packages MUST be signed; unsigned publish denied.
2. Registry MUST be customer-mirrorable (exportMirror / importMirror).
3. No phone-home to a Smartware SaaS registry by default.
4. Partners publish only when status === approved.
5. Do not scaffold M3.7 AI scheduler / billing until directed.
```

---

## § 1 — Summary

Ship a **MarketplaceRegistry**: partner onboarding, signed DAG node/connector/template packages, verification on resolve, and full registry mirror export/import for air-gapped or customer-operated installs.

---

## § 2 — Design

### 2.1 Partner

`onboardPartner` → `pending`; `approvePartner` → `approved`. Only approved partners may `publish`.

### 2.2 Package

```typescript
interface MarketplacePackage {
  packageId: string;
  name: string;
  version: string;
  kind: "node-type" | "connector" | "template";
  partnerId: string;
  payloadHash: string;
  signature: string;
}
```

Signature = HMAC-SHA256(partnerSigningSecret, canonical manifest).

### 2.3 Mirror

`exportMirror()` returns JSON snapshot; `importMirror(snapshot)` loads into a local registry (ownerware).

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("next"). Linked to M3.6.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0019 · M3.6*
