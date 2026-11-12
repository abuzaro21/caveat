# Response to Codex adversarial review 1

Review: [codex-review-1.md](codex-review-1.md). It was produced by the Codex CLI (`codex exec`, model `gpt-6.1-sol`, read-only sandbox), run against commit `0c5e468`. The CLI log records `model: gpt-6.1-sol` and exit code 0. Codex's verdict was **DO NOT SHIP**.

We accepted all nine findings. Each one now has a regression test in [`test/review1.test.ts`](../../test/review1.test.ts), numbered to match the finding. We ran the new tests against the pre-fix source with `git stash` on `src/`, and 7 of the 9 failed:

- **R1-2** passed on the old code because a stronger memory happened to mask the bug. We then added a policy-level assertion that fails without the fix.
- **R1-9** cannot fail on SQLite, because its global transaction chain serialises everything (Codex noted the same). The fix is structural, and the test runs on PostgreSQL in CI.

After the fixes, the full suite passes (58 of 58).

| # | Finding | Fix | Where |
|---|---|---|---|
| 1 | A malformed request target crashed the process | The URL is now parsed inside the request's error boundary, and a malformed target returns 400. The test sends `GET http://[` over a raw socket, then checks that `/api/health` still answers. | `src/server.ts` |
| 2 | Caller-declared lineages manufactured corroboration | Independence now comes only from the server. Every unsigned import gets the same fixed lineage, `unsigned-import`, and unsigned items never count toward corroboration. A caller's label is kept as display text only. | `src/memory.ts` ingest, `src/policy.ts` step 7 |
| 3 | One unsigned matching report refreshed authority and erased disagreement | A memory is now dated only by the support that establishes its effective grade. For a corroborated memory, that is the moment the second independent source reported. Weaker agreeing items are still shown, labelled "agrees, but at lower authority: shown, cannot refresh or settle it". They no longer make newer conflicting evidence look outdated. | `src/policy.ts` step 7–8 |
| 4 | Booking text survived a forget while verification passed | Every part of a booking's stored explanation now records the evidence ids it came from (`bookings.parts`). Forgetting replaces those parts by dependency rather than by word matching, including the window label, which becomes the slot's hours. The booking itself stays, because it is an action already taken. A new check, "Booking text derived from deleted evidence", confirms the result. The marker scan also now covers three-letter words such as "Gym". | `src/memory.ts` book, purge, verify |
| 5 | The worker inbox kept forgotten plaintext | A queued job now holds only evidence ids and the base revision. When released, it rebuilds its data from current storage under the session lock. A forget also strips its ids from any queued job. A new check, "Queued jobs holding a copy of it", confirms this. | `src/memory.ts` worker |
| 6 | `before` mode accepted re-dated copies and refused immediate relearning | After a `before` forget, an unsigned import can never bring the topic back, because its date is chosen by the caller. A signed import must postdate the forget. Chat statements and corrections are accepted, because the server stamps them and serialises them after the tombstone. | `src/memory.ts` ingest |
| 7 | Static file serving checked a string prefix | Containment is now checked with `path.relative()` path components. NUL bytes and malformed percent-encoding are rejected. The test probes the sibling-prefix case `test/h` → `test/helpers.ts`. | `src/server.ts` |
| 8 | A future hold did not constrain the delivery date | The planner now checks holds at each candidate slot's start and end, and skips any slot a hold covers. | `src/tasks.ts` |
| 9 | A PostgreSQL export could sign a revision that didn't match its evidence | The export now reads through `tx(sid)`, the session-row lock, so it uses one consistent snapshot. | `src/memory.ts` exportEnvelope |

## What we did not change

- **Holds are checked at the start and end of each slot, not across the full interval.** A hold that falls strictly inside one four-hour slot is missed. In this model holds last days, not minutes.
- **The demo's marker scan is still a secondary check.** Dependency tracking is now how deletion works, and the scan only catches text we failed to track.
