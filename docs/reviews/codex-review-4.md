# Codex adversarial review 4 (verbatim)

Model: `gpt-6.1-sol` (from Codex CLI runtime metadata). Sandbox: read-only. Session: `01a1d09e-0477-7fd2-8241-2fb51bbf781c`. Commit reviewed: `64c41a9`. Brief: [codex-review-4-brief.md](codex-review-4-brief.md). Our response: [codex-review-4-response.md](codex-review-4-response.md).

The final message is reproduced unchanged below.

---

Reviewed `64c41a9380edeabf2b0235d66f2b0ca0fea4b43e`. All 62 supplied SQLite tests passed. Additional probes found two MEDIUM defects; no HIGH defect was reproduced.

1. **MEDIUM — Fixed page vocabulary still causes false proof failures.**  
   [App.tsx:49](/E:/doo/caveat/ui/src/App.tsx:49) excludes vocabulary found in retained state, but the expanded page check searches fixed interface text too ([App.tsx:243](/E:/doo/caveat/ui/src/App.tsx:243)).

   **Reproduction:** Relearn the private location with matching label and excerpt `Talking`, `Assistant`, or `Proof`, then forget it. The server verifies deletion and the first five proofs pass. The page proof fails because fixed copy contains “Talking to Maya”, “Assistant”, or “Forget with proof”. The handler harness reproduced all three cases.

   **Fix:** Distinguish fixed interface vocabulary from memory-derived content when checking the page. Add these cases alongside C3.

2. **MEDIUM — Existing ingest-audit IDs break the new identifier checks.**  
   [App.tsx:52](/E:/doo/caveat/ui/src/App.tsx:52) always collects deleted evidence IDs; the reload, import and worker proofs search serialized state containing the audit tail. [memory.ts:221](/E:/doo/caveat/src/memory.ts:221) changes newly written ingest entries to counts, but existing entries retain their old `stored: [evidenceId]` format.

   **Reproduction:** Preserve a pre-fix-format ingest entry for the `Gym` record, then forget it. The receipt verifies deletion, the fresh export contains no location record, and backup restoration is refused. Nevertheless, reload, import and worker proofs each fail with “1 trace of it found”, solely because the audit retains the identifier.

   **Fix:** Normalize existing ingest-audit entries to counts, or distinguish historical audit identifiers from surviving evidence and derived content.

| Review-3 issue | Status | Evidence |
|---|---|---|
| Search terms and composer draft retained | **CLOSED** | Actual-handler probes confirmed an empty composer and cleared search terms after all six proofs pass; closing after failed proofs also clears search terms. See [App.tsx:189](/E:/doo/caveat/ui/src/App.tsx:189), [App.tsx:251](/E:/doo/caveat/ui/src/App.tsx:251), and [App.tsx:372](/E:/doo/caveat/ui/src/App.tsx:372). |
| Legacy booking text without surviving evidence | **CLOSED** | R3-2 passed. Additional zero-evidence probes rewrote the legacy explanation in both modes; repeated forgetting remained verified. See [memory.ts:388](/E:/doo/caveat/src/memory.ts:388). |
| False failures on ordinary vocabulary | **PARTIAL** | `Home` now passes all six proofs, but fixed interface vocabulary still fails; finding 1. |

**Verdict: DO NOT SHIP.**

Not run: PostgreSQL or real-browser E2E; Playwright temporary-directory creation was denied. UI reproductions used actual handlers, rendered component text and SQLite. No repository files were modified by this review.
