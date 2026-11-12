# Response to Codex review 2

Review 2 (`codex exec -m gpt-6.1-sol -s read-only`, reviewing commit `a4596e6`) confirmed that 7 of the 9 review-1 findings were closed and 2 were partial. It also found three new problems and returned **DO NOT SHIP**. All three are fixed. Each fix has a regression test, and the two unit tests were run against the pre-fix source to confirm they fail there.

| # | Finding | Fix | Regression test | Fails before fix |
|---|---|---|---|---|
| 1 | HIGH: forgotten content stayed in the page transcript while all five browser proofs passed. The word-marker redaction could end up with no markers at all (short words such as "Gym" were ignored, and common words were filtered out). | The page no longer redacts word by word. A forget drops the whole transcript, the focused evidence panel and the naive panel, then says why. After the import proof, the tab discards its backup copy. A sixth proof, **"This page"**, searches everything the page still holds for every exact value label and excerpt of the forgotten memory, plus any distinctive words. If there is nothing to search for, it **fails** rather than passing. Distinctive words now include 3-letter words. | `e2e/caveat.spec.ts` "C2" (desktop and mobile): forget the seeded location, relearn it as "Gym", ask about it, forget again. All 6 proofs must pass and "Gym" must be gone from the page. | Not run against the pre-fix UI. The old UI has 5 proofs, so the test cannot pass there. Codex reproduced the leak with the App handlers. |
| 2 | HIGH: a database created before `bookings.parts` existed could not forget (`no such column: parts`), so the transaction rolled back and the content stayed stored. | Both drivers migrate on open, before any request is served: they add the column if it is missing and backfill old rows. Old rows get a conservative dependency marker that matches **every** forget or retention purge, so their untracked explanation is rewritten the first time anything is forgotten. Nothing is left as untracked plaintext. The verification check now also counts any remaining legacy markers. | `test/review2.test.ts` R2-2: book with a reason that quotes "Harbour", drop the `parts` column, reopen, forget. The receipt must verify, the booking must be kept with its text rewritten, and a new booking must work. Runs on SQLite and on PostgreSQL. | Yes |
| 3 | MEDIUM: a hold wholly inside a delivery slot (14:00–16:00 inside 13:00–17:00) did not block the slot. | Holds are evaluated at both ends of the slot **and** at every hold-validity boundary that falls inside it (the boundary and one millisecond before). | `test/review2.test.ts` R2-3 | Yes |

## Review-1 items Codex marked partial

- **R1-4 (booking copies):** partial only because of finding 2. Now closed.
- **R1-8 (future holds):** partial only because of finding 3. Now closed.

## Results after the fixes

- `npm test`: 60/60 on SQLite and 60/60 on PostgreSQL 16.
- `npx playwright test`: 14/14 (7 tests × desktop and mobile).
