# Response to Codex review 5

Review 5 (GPT-6.1 Sol, read-only, reviewing release candidate `bf1d5f0`) covered every change after review 4: the fixed-vocabulary page proof, the audit-entry migration, booking records after a forget, and the receipt's id scans. It raised one MEDIUM finding and returned **DO NOT SHIP**. The finding is fixed.

| # | Finding | Fix | Regression test | Fails before fix |
|---|---|---|---|---|
| 1 | MEDIUM: when the forgotten memory had no distinctive terms (a label of ordinary words such as "Home"), the receipt skipped all four table scans. A deleted id left in the audit log was then unchecked, and the receipt verified with 10 checks instead of 14. | The four table scans (summaries, bookings, audit, receipts) now always run, and always check the deleted records' ids. Only the search-index check depends on distinctive terms. With none, it reports "none to check" instead of disappearing. Every receipt now has 14 checks. | `test/review2.test.ts` R5-2, Codex's reproduction: relearn the location as "Home", leave its id in an old-format audit entry written after the migration has run, and forget it. The receipt must fail verification on "Deleted content in audit", with 14 checks. A clean forget of the same memory must verify, also with 14 checks. Runs on SQLite and PostgreSQL. | Yes (10 checks; checked with `git stash`) |

Codex noted that this shows a defect in the verifier, not that the migration leaves old entries behind. The test writes the old-format entry after the database is opened, so the verifier is the only defence it exercises.

## Results after the fix

- `npm run typecheck` and `npm run build`: pass.
- `npm test`: 65/65 on SQLite and 65/65 on PostgreSQL 16.
- `npx playwright test`: 22/22 (11 tests × desktop and mobile).

The clean-clone run of the full local CI for the release commit is in `docs/evidence/local-ci.log`.

This fix has not been reviewed by Codex again.
