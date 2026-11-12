# Response to Codex review 3

Review 3 (GPT-6.1 Sol, read-only, reviewing commit `eeb8aa9`) closed the hold fix. It marked the other two review-2 fixes as partial, raised three findings, and returned **DO NOT SHIP**. All three findings are fixed.

| # | Finding | Fix | Regression test | Fails before fix |
|---|---|---|---|---|
| 1 | HIGH: the page proof's own search terms kept the forgotten text in the tab after the proofs passed. A draft left in the composer also survived. | The composer is cleared on forget. The search terms are dropped as soon as every proof passes, or when the dialog closes. The page proof now checks: the rendered text of the whole app, the transcript, the composer, and the evidence and naive panels. Proof details report counts ("1 trace of it found"), never the text itself. | e2e "C2": a draft "I went to Gym" in the composer is cleared, all six proofs pass, and "Gym" is nowhere on the page | Not run against the pre-fix UI. Codex reproduced it with the App handlers. |
| 2 | HIGH: a legacy booking whose evidence an older engine had already deleted kept quoting it, because `purge()` returned early when there was nothing left to delete | The early return is removed. Only the SQL that depends on ids is skipped when there are none, so legacy explanations are rewritten on any forget. | `test/review2.test.ts` R3-2: a booking that quotes "Gym", with no `parts` column and the evidence already deleted. After migration, a forget verifies and no "Gym" remains. Runs on SQLite and PostgreSQL. | Yes |
| 3 | MEDIUM: an exact-text check produced false failures when the memory's text was ordinary vocabulary such as "Home", which appears in records that are kept | Proofs now search for **the deleted records' ids** plus **text found only in the deleted records**. Text that also appears in records that are kept is left out, because it cannot prove a leak. The ask proof also requires every decision on the topic to be ABSTAIN. The export proof also requires zero records about the topic. | e2e "C3": relearn the location as "Home", forget it, and all six proofs pass | Not run against the pre-fix UI. Codex reproduced it with the App handlers. |

Fixing finding 3 exposed a further problem: the audit log's `ingest` entries recorded the ids of stored evidence, so a deleted record's id stayed in the audit log. The documentation says audit entries carry counts only. Ingest entries now record a count, which matches.

## Results after the fixes

- `npm test`: 62/62 on SQLite and 62/62 on PostgreSQL 16.
- `npx playwright test`: 16/16 (8 tests × desktop and mobile).
