---
label: RFC:RESEARCH-AI-COPILOT-v1
classification: NORMATIVE
security_level: INTERNAL
rfc_number: "0028"
title: "Research Track — AI Co-Pilot (Grok + Gemini) for Workflow Authoring and Optimisation"
status: accepted
created: 2026-09-09
updated: 2026-09-09
author: Bell Corporate Labs
dri: "Bell Corporate Labs"
phase: OS
milestone: "Research-AiCopilot"
authority: docs/AI_INSTRUCTIONS.md
supersedes: ~
superseded_by: ~
blocked_by: ~
---

# RFC-0028 — AI Co-Pilot Research Track

> **Status:** `accepted`
> **DRI:** Bell Corporate Labs
> **Phase:** OS — Research
> **Milestone:** AI Co-Pilot (scaffold)
> **Created:** 2026-09-09
> **Last Updated:** 2026-09-09

---

## Agent Instructions

```
1. ACCEPTED. Ship AiCopilot scaffold for workflow authoring
   suggestions and optimisation hints.
2. Providers: grok | gemini | local.
   - grok / gemini require customer-held API keys (ownerware).
   - local is offline rule-based fallback (no network).
3. Co-pilot defaults DISABLED. No phone-home. No Smartware-hosted keys.
4. Inject fetch for tests; never hardcode secrets or provider tokens.
5. Fail-closed when enabled without key (cloud providers) or on bad responses.
```

---

## § 1 — Summary

Introduce **AiCopilot**: opt-in assistant that (a) drafts workflow
node sketches from a natural-language brief, and (b) suggests
optimisation hints for an existing DAG sketch. Supported providers
are **Grok** (xAI), **Gemini** (Google), and **local** (offline).
Customer holds keys; default off.

---

## § 8 — Sign-Off Record

```
2026-09-09 | Bell Corporate Labs | Status: draft → accepted
  Directed in session ("Lets direct the RFC for Co-Pilot, and can we
  add for Grok, and Gemini"). Linked to Research-AiCopilot.
  Sign-off directed by the DRI; agent recorded the entry.
```

---

*Bell Corporate Labs · RFC-0028 · AI Co-Pilot*
