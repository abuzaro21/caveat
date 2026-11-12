# Codex review 4 brief: verify the review-3 fixes

You are reviewing CAVEAT at commit `64c41a9`. Run read-only and modify no files.

Review 3 (`docs/reviews/codex-review-3.md`) found three issues. The responses are in `docs/reviews/codex-review-3-response.md`.

1. The page proof's search terms and the composer draft were kept in the tab. See `ui/src/App.tsx`: `needlesOf`, `confirmForget`, `prove`, and the dialog's `onClose`.
2. Legacy booking text with no surviving evidence. See `purge()` in `src/memory.ts`.
3. False proof failures on ordinary vocabulary. See `needlesOf` and the proofs in `ui/src/App.tsx`.

For each issue, try to bypass the fix and report CLOSED, PARTIAL or OPEN, with evidence. Then look for any new HIGH or MEDIUM defect these changes introduced, especially in forgetting, verification and the browser proofs.

The tests are `test/review2.test.ts` and `e2e/caveat.spec.ts` (C2, C3). You may run `node --disable-warning=ExperimentalWarning --test test/*.test.ts` and write scratch files only outside the repository.

Output: a findings list ranked by severity, a status table for the three items, and a one-line verdict of SHIP or DO NOT SHIP. Keep it under 900 words.
