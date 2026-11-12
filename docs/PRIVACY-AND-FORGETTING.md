# Privacy and forgetting

## Data handled

There is **no real personal data**. Every visitor gets a fresh, isolated, synthetic household: Maya, Sam, "Harbour Physio", "Rua das Flores", ParcelCo. All of it is fictional. Sessions are identified by an HttpOnly, SameSite=Strict cookie, and the server stores only sha256 of the cookie token. Idle sessions are deleted after 3 hours, along with everything in them. Logs record request method, path and error class, never bodies or memory content (`test/http.test.ts` scans the logs for leaks).

## Sensitive memories

The private recurring location is marked **sensitive**, which has three consequences:

- It is used only for the purpose Maya consented to (`delivery-planning`): avoiding delivery slots while she is out.
- It is never shared with other household members.
- It is visible only to Maya, through inspection.

Any other purpose gets ABSTAIN with `blockedBy: consent`.

## What "forget" does

There are two modes. **"Stop using but keep" is not offered**, because hiding a memory while keeping it is exactly the fake deletion this project exists to avoid.

| Mode | Deletes | Afterwards |
|---|---|---|
| **Delete and never relearn** (`block`) | All evidence for the topic, and everything derived from it | Nothing about the topic is learned again, from any channel |
| **Delete what you know, may relearn** (`before`) | Same | Anything observed before the forget is refused, including old exports, re-dated copies and unsigned imports. A new statement from Maya may be learned. |

In one transaction, with the session locked:

1. Delete the evidence rows.
2. Delete their search-index entries and usage records.
3. Rewrite booking text derived from that evidence, **by recorded dependency**:
   - each reason part that depended on it becomes "[removed: it relied on a memory you asked me to forget]";
   - a window label that depended on it becomes the slot's hours.

   The booking itself stays, because it is an action already taken.
4. Rebuild derived summaries.
5. Write a tombstone: person, topic, mode, revocation time and revision. **It holds no value and no fingerprint of a value.** A hash of a low-entropy value, such as a weekday and an hour range, could be reversed by trying every possibility.
6. Bump the revision and write an audit line with counts only.

After the commit:

- Purge the decision cache and raise the cache floor.
- Strip the forgotten ids from any queued job.
- Compact SQLite storage with `secure_delete` and `wal_checkpoint(TRUNCATE)`.
- Run 14 verification checks: evidence rows; orphaned index entries; booking text with a dependency on the deleted rows; orphaned usage records; distinctive terms left in the index (reported as "none to check" when the memory has no distinctive terms); deleted content in summaries, bookings, the audit log and receipts, meaning distinctive terms or the deleted records' ids, checked every time; tombstone columns; a fresh export; the worker inbox; the cache; and retrieval returning ABSTAIN.
- Issue a **content-free receipt**: what was deleted (counts), what was rewritten, what was kept, every check with expected and actual values, and the limits.

**Scheduled retention** works the same way without anyone asking: courier logs and third-party reports about delivery windows are deleted after 60 virtual days, with their own receipt.

## Resurrection attempts and what stops them

| Attempt | Stopped by | Test |
|---|---|---|
| Ask again | Revocation filter before search; retrieval returns ABSTAIN | `scenarios.test.ts`, e2e C |
| Restart the server | Tombstones and deletions are committed. The SQLite file and WAL are byte-scanned for "Harbour", "Physio" and "Flores" after restart. | `restart.test.ts` |
| Restore the signed export taken before the forget | Ingest checks the tombstone: `block` rejects; `before` rejects anything observed at or before the revocation | `restart.test.ts`, e2e C |
| Re-date the old copy and import it unsigned | An unsigned import can never restore a forgotten topic | `review1.test.ts` R1-6 |
| Release a delayed job queued before the forget | The job holds ids and revision only, and is fenced by revision | `adversarial.test.ts`, `review1.test.ts` R1-5 |
| A read racing the forget | Both lock the session row: the read is ordered entirely before or after the forget. The cache floor stops a raced result being cached. | `adversarial.test.ts` |
| Booking text and summaries quoting it | Rewritten by dependency; verified | `review1.test.ts` R1-4 |

## What CAVEAT cannot erase

The receipt says this in plain words:

- **Copies outside CAVEAT.** A downloaded export, a screenshot, an answer already shown. They can no longer be re-imported into this memory, but CAVEAT cannot erase them.
- **PostgreSQL storage below the query layer.** Deleted rows vanish from queries at once, but their bytes can persist in pages until vacuum, in the write-ahead log, and in the hosting provider's backups for its retention period. CAVEAT cannot purge provider backups. The SQLite byte-level guarantee is tested; the PostgreSQL one is not claimed.
- **A retrieval that finished before the forget** may already have put the memory on someone's screen. The browser redacts its own transcript after a forget, but it cannot reach other screens.
