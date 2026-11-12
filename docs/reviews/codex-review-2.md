Reviewed `a4596e6964d279ba093d9a7bdc061a75e9d962c7`. All nine supplied regression tests pass on SQLite. Additional probes found two HIGH issues and one remaining MEDIUM issue.

1. **HIGH — Forgotten private content remains visible while every browser proof passes.**  
   Evidence: [App.tsx:24](E:/doo/caveat/ui/src/App.tsx:24), [App.tsx:163](E:/doo/caveat/ui/src/App.tsx:163), [App.tsx:184](E:/doo/caveat/ui/src/App.tsx:184).

   **Reproduction:** Forget the seeded private location using `before`, then tell the server `{label:'Gym',day:'fri',from:15,to:17}`, with excerpt `Gym`. Ask about Friday, then forget that location through the UI. Executing the actual App handlers reproduced:
   - Server receipt: `verified:true`; server state contains no `Gym`.
   - Browser markers: `[]`.
   - Transcript still displays `Gym, Fridays 15:00–17:00`.
   - All five browser proofs report `pass`.

   Three-character words are excluded; common words and numbers remove the remaining markers. Redaction therefore does nothing. It also excludes message `ask` and `plan` fields.

   **Minimal fix:** Clear the transcript and focused evidence on forgetting, or purge complete message objects using predicate/evidence dependencies. Browser verification must inspect retained browser state and cannot treat an empty keyword check as proof.

2. **HIGH — The new booking schema breaks forgetting on existing databases.**  
   Evidence: [db.ts:42](E:/doo/caveat/src/db.ts:42), [db.ts:70](E:/doo/caveat/src/db.ts:70), [db.ts:104](E:/doo/caveat/src/db.ts:104), [memory.ts:395](E:/doo/caveat/src/memory.ts:395).

   **Reproduction:** Initialize the previous schema without `bookings.parts`, then execute current initialization and forget `location.private`. An in-memory upgrade simulation throws `no such column: parts`; the transaction rolls back, leaving `Harbour Physio` stored. This happens even with no bookings.

   `CREATE TABLE IF NOT EXISTS` does not upgrade the existing table. New bookings also fail against that schema.

   **Minimal fix:** Run a migration before serving requests. Add `parts` and conservatively backfill dependencies or redact legacy explanations; defaulting legacy rows to empty dependencies would preserve untracked plaintext.

3. **MEDIUM — A hold wholly inside a delivery slot still permits booking.**  
   Evidence: [tasks.ts:63](E:/doo/caveat/src/tasks.ts:63), [memory.ts:190](E:/doo/caveat/src/memory.ts:190).

   **Reproduction:** Correct home deliveries to `afternoon`, forget the private schedule, and ingest an authoritative hold for **13 November 2026, 14:00–16:00**. Planning returns `canBook:true` for **13:00–17:00**, and `book()` succeeds.

   Checking only the endpoints misses the overlap. The response acknowledges this limitation, but ingestion accepts such intervals.

   **Minimal fix:** Evaluate holds throughout the candidate interval, including validity boundaries inside it.

The original nine findings resolve as follows:

| Original | Status | Evidence and bypass result |
|---|---|---|
| 1 — malformed URL crash | **CLOSED** | [server.ts:138](E:/doo/caveat/src/server.ts:138). Additional malformed absolute targets returned 400; health remained 200. |
| 2 — manufactured corroboration | **CLOSED** | [memory.ts:212](E:/doo/caveat/src/memory.ts:212), [policy.ts:135](E:/doo/caveat/src/policy.ts:135). Forged `sourceKind`, channel and distinct lineages remained unsigned third-party evidence; booking stayed blocked. |
| 3 — weak agreement refreshes authority | **CLOSED** | [policy.ts:139](E:/doo/caveat/src/policy.ts:139). Three fresh unsigned echoes left a correction aged 181 days at `ASK`. A corroborated 100-day-old office schedule also stayed stale despite fresh unsigned agreement. |
| 4 — booking copies survive forgetting | **PARTIAL** | [memory.ts:400](E:/doo/caveat/src/memory.ts:400). Multiple bookings were redacted correctly on a fresh schema, including window labels. Existing databases fail before deletion: finding 2 above. |
| 5 — worker retains plaintext | **CLOSED** | [memory.ts:50](E:/doo/caveat/src/memory.ts:50), [memory.ts:536](E:/doo/caveat/src/memory.ts:536). Jobs hold identifiers; old jobs were fenced after forgetting/relearning. Newly queued jobs preserved only current content. |
| 6 — `before` resurrection/relearning | **CLOSED** | [memory.ts:198](E:/doo/caveat/src/memory.ts:198). Old signed and retimestamped modified envelopes were rejected; immediate owner statements and subsequent corrections were accepted. |
| 7 — static sibling traversal | **CLOSED** | [server.ts:123](E:/doo/caveat/src/server.ts:123). Encoded traversal, backslashes, malformed encoding and NUL variants returned 400. |
| 8 — future holds | **PARTIAL** | [tasks.ts:63](E:/doo/caveat/src/tasks.ts:63). Covered endpoints are blocked; interior overlap still books: finding 3 above. |
| 9 — inconsistent export revision | **CLOSED** | [memory.ts:493](E:/doo/caveat/src/memory.ts:493), [db.ts:116](E:/doo/caveat/src/db.ts:116). Export now requests the session lock. PostgreSQL closure is source-grounded; runtime concurrency was not tested here. |

**Verdict: DO NOT SHIP.** Remaining fixes, in priority order:

1. Purge browser-held content and verify that purge.
2. Migrate legacy bookings safely.
3. Enforce full-interval delivery holds.

Not run: PostgreSQL execution, disk/WAL/restart tests, or real-browser E2E; UI results used an App-handler harness. No files modified. Browser disclosure and failed upgrade deletion are reproduced risks.
