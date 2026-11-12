# Codex review 5 brief: final release review

You are reviewing CAVEAT at commit `bf1d5f0`, the release candidate. Run read-only and modify no files.

Review 4 (`docs/reviews/codex-review-4.md`) reviewed commit `64c41a9`. Nothing after it has been independently reviewed. Run `git diff 64c41a9..bf1d5f0 -- src ui test e2e` to see the code under review. The responses are in `docs/reviews/codex-review-4-response.md`, including one defect Claude found while filming (R5-1).

The changes since review 4:

1. The page proof drops search terms that appear in the app's own script bundles (`fixedVocabulary` in `ui/src/App.tsx`).
2. A migration on open rewrites old `ingest` audit entries (`stored: [ids]`) and old `task.booked` entries (`relied_on: [ids]`) to counts (`src/db.ts`: `AUDIT_SELECT`, `auditCount`). New entries record counts (`src/memory.ts`).
3. The receipt's four table scans (summaries, bookings, audit, receipts) also look for the deleted records' ids (`verify()` in `src/memory.ts`). The receipt still has 14 checks.

Focus on these areas, against the final code:

- forgetting receipts and their 14 checks: can one pass while deleted content or ids remain;
- sensitive record ids in historical and new audit entries, and the migration of old entries on both SQLite and PostgreSQL;
- booking records after a forget (reason, parts, evidence ids);
- privacy revocation against an in-flight retrieval;
- resurrection through restore or import of an old export;
- deletion of cached decisions and derived data;
- cross-session isolation.

Report only genuine defects you can reproduce or show clearly in the code, each with a severity of HIGH, MEDIUM or LOW. Don't propose architectural rewrites.

The tests are in `test/` and `e2e/`. You may run `node --disable-warning=ExperimentalWarning --test --test-concurrency=1 "test/**/*.test.ts"` and write scratch files only outside the repository.

Output: a findings list ranked by severity, with a reproduction for each, and a one-line verdict of SHIP or DO NOT SHIP. Keep it under 900 words.
