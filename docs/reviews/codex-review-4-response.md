# Response to Codex review 4

Review 4 (GPT-6.1 Sol, read-only, reviewing commit `64c41a9`) closed two of the three review-3 findings and marked the third as partial. It found no HIGH defect. It raised two MEDIUM findings and returned **DO NOT SHIP**. Both findings are fixed.

| # | Finding | Fix | Regression test | Fails before fix |
|---|---|---|---|---|
| 1 | MEDIUM: the page proof failed falsely when the forgotten memory's text was also part of the interface's own fixed wording, such as "Talking" ("Talking to Maya"), "Assistant" or "Proof" ("Forget with proof") | The page proof reads the app's own script bundles once and drops any search term that appears in them. A word the interface always shows cannot prove that the page kept a memory. The deleted records' ids are still always searched for. The other five proofs, which search server responses rather than the page, are unchanged. | e2e "C3" now runs three times: memories labelled "Home", "Talking" and "Proof" are relearned, forgotten, and pass all six proofs, on desktop and mobile | Yes. Run against the build that still had the earlier page proof, "Talking" and "Proof" failed on both projects (4 failures) and "Home" passed. |
| 2 | MEDIUM: ingest audit entries written before review 3 still held evidence ids (`stored: [id]`), so the reload, import and worker proofs found "1 trace" even though the record was deleted | A migration runs when the database opens, on both SQLite and PostgreSQL. It rewrites every old ingest entry from a list of ids to a count, which matches the documented rule that audit entries carry counts only. | `test/review2.test.ts` R4-2: an old-format ingest entry for a stored record is rewritten on open. After the forget, no audit entry contains the deleted id. Runs on SQLite and PostgreSQL. | Yes (checked with `git stash`) |

## Review-3 status as reported by Codex

| Review-3 issue | Codex status | Now |
|---|---|---|
| Search terms and composer draft retained | CLOSED | CLOSED |
| Legacy booking text without surviving evidence | CLOSED | CLOSED |
| False failures on ordinary vocabulary | PARTIAL | Fixed by finding 1 above |

## Found after review 4, while capturing the film

The film books the sofa before it forgets, and no test did that. In that order the reload, import and worker proofs found "1 trace". The cause was the `task.booked` audit entry, which listed the ids of the evidence a booking relied on. After a forget, the deleted record's id stayed in the audit log, and the receipt still verified because its audit scan looked for content words, not ids. It was the same class of defect as finding 2.

- `task.booked` entries now record a count (`relied_on: 2`), and the open-time migration rewrites old entries too.
- The receipt's four table scans (summaries, bookings, audit, receipts) now also look for the deleted records' ids, so this would fail verification instead of passing silently. Bookings are scanned on their reason and their evidence-id list. The receipt still has 14 checks.
- Regression test R5-1 books, forgets, and asserts that no deleted id appears anywhere in the session state. It also migrates an old-format booking entry. It fails on the pre-fix source (checked with `git stash`).
- e2e "C4" books the sofa, runs the stale-memory check, then forgets and requires all six proofs to pass.

## Results after the fixes

- `npm test`: 64/64 on SQLite and 64/64 on PostgreSQL 16 (`docs/evidence/test-sqlite.log`, `test-postgres.log`).
- `npx playwright test`: 22/22 (11 tests × desktop and mobile) (`docs/evidence/e2e.log`).

These fixes have not been reviewed by Codex again.
