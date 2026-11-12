# Codex review 3 (verification of review-2 fixes)

Model `gpt-6.1-sol` via `codex exec -s read-only`, session `01a1d088-c1cf-7c70-9488-c77eb911d362`. Final message, verbatim:

Reviewed `eeb8aa9fac287e813e56f49e1967e616ea202ab5`. All 60 supplied tests passed on SQLite. Additional probes found:

1. **HIGH — Forgotten private text remains in the page while all six proofs pass.**  
   [App.tsx:167](E:/doo/caveat/ui/src/App.tsx:167) retains complete excerpts and value labels in `markersRef.current.content`. The page proof searches only messages, focused evidence and the naive panel ([App.tsx:232](E:/doo/caveat/ui/src/App.tsx:232)); closing the dialog leaves those needles intact ([App.tsx:356](E:/doo/caveat/ui/src/App.tsx:356)).

   **Reproduction:** Execute the actual App handlers for the seeded location, run all proofs, then close. All six report `pass`, and `backup` is cleared, but the ref still contains the complete private excerpt, including “Harbour Physio” and “Rua das Flores”. Separately, leaving `I went to Gym` in the composer before forgetting preserves that visible draft while all six proofs pass.

   **Fix:** Clear the composer during forgetting and discard verification plaintext when verification finishes or the dialog closes. Include all retained application content in the page check.

2. **HIGH — Migrated legacy explanations survive forgetting when their evidence is already gone.**  
   The new legacy dependency handling ([memory.ts:398](E:/doo/caveat/src/memory.ts:398)) is unreachable when `ids` is empty because of the early return at [memory.ts:388](E:/doo/caveat/src/memory.ts:388).

   **Reproduction:** Using the actual pre-`parts` engine at `0c5e468`, correct the private location to `Gym`, book an afternoon delivery, then forget the location. That version deletes the evidence but leaves `Gym` in the booking reason. Run the current migration against that database and repeat the forget. The current receipt reports `deleted.evidence:0`, `rewritten.bookingReasons:0`, and `verified:false`; both `reason` and migrated `parts` retain `Gym`. Repeating the request cannot repair it.

   **Fix:** Process legacy booking dependencies even when there are no evidence IDs to delete; guard only the ID-dependent SQL.

3. **MEDIUM — Exact-text verification mistakes unrelated vocabulary for retained memory.**  
   [App.tsx:38](E:/doo/caveat/ui/src/App.tsx:38) collects common labels as content needles; [App.tsx:45](E:/doo/caveat/ui/src/App.tsx:45) matches them against arbitrary serialized fields.

   **Reproduction:** Relearn the private location with label and excerpt `Home`, then forget it. The server verifies deletion and the fresh export contains zero private-location records. Nevertheless, reload, export, import and worker proofs fail because unrelated delivery records contain the scope `"home"`. The distinctive-marker list is empty; the newly added content matching causes these failures.

   **Fix:** Verify topic/evidence dependencies and relevant content fields. Text shared with independent retained records must not establish a deletion failure.

| Review-2 issue | Status | Evidence |
|---|---|---|
| Browser-held copies | **PARTIAL** | Transcript and panels clear, but verification plaintext and composer content remain; finding 1. |
| Legacy schema without `parts` | **PARTIAL** | Migration and ordinary deletion work; historical copies without surviving evidence remain; finding 2. |
| Hold wholly inside a slot | **CLOSED** | Supplied regression and ten additional interval cases passed through planning and booking, including interior, endpoint, fractional and zero-length intervals. See [tasks.ts:64](E:/doo/caveat/src/tasks.ts:64). |

**Verdict: DO NOT SHIP.**

Not run: PostgreSQL runtime or real-browser E2E; UI reproductions used actual-handler harnesses. No files modified by this review; unrelated concurrent workspace edits were left untouched.
