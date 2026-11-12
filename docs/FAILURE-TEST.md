# Failure test: scenario C, end to end

The claim under test: **after Maya forgets her private recurring location, nothing CAVEAT controls can produce it again.** That includes a restart, an old backup, a delayed job, the page in front of her, and the derived text that quoted it.

## The setup

The seeded memory is "Harbour Physio, Fridays 15:00–17:00", from a chat on Rua das Flores. Before the forget, the demo deliberately creates the two copies that a forget usually misses:

1. a **signed export** held in the browser tab, standing in for a backup kept outside CAVEAT;
2. a **delayed digest job** queued against memory as it is now, standing in for a worker in another process.

A sofa booking made earlier skipped Friday 13 Nov *because* of this memory, so its explanation quotes it.

## What runs

| Step | Where | Pass condition |
|---|---|---|
| Forget, in one locked transaction | server | Evidence, index entries and usage records deleted. The booking explanation is rewritten by recorded dependency. Summaries are rebuilt and a content-free tombstone is written. |
| 14 post-commit checks | server, shown on the receipt | Every check passes, with expected and actual values (listed in [PRIVACY-AND-FORGETTING.md](PRIVACY-AND-FORGETTING.md)) |
| Proof 1: ask again | browser to API | The reply contains none of the memory's text (the server decision is ABSTAIN, blocked by `revoked`: `scenarios.test.ts`) |
| Proof 2: cold reload | browser to API | Every cache is dropped and state rebuilt from storage, with no trace |
| Proof 3: export now | browser to API | The new export contains no record about it |
| Proof 4: restore the old backup | browser to API | The signed records are refused ("topic revoked: not relearned"), and the tab's copy is then discarded |
| Proof 5: release the delayed job | browser to API | The job is fenced by revision and discarded without writing |
| Proof 6: this page | browser | The transcript, evidence panel and naive panel hold none of the memory's exact phrases or distinctive words. The proof fails if there is nothing to search for. |
| Restart | `test/restart.test.ts` | The server process is stopped (SIGTERM, then SIGKILL after 4 s), and the SQLite file and WAL are byte-scanned for "Harbour", "Physio" and "Flores". After a start the memory is still forgotten, the booking is kept and redacted, and the old export is refused. |

## Variants tested

- **"Delete what you know, may relearn" mode.** A re-dated copy of the old record, and the same record as an unsigned import, are both refused. A new statement from Maya is accepted. (`review1.test.ts` R1-6, `scenarios.test.ts`)
- **A short, relearned memory** ("Gym"), forgotten again after the agent quoted it. All six proofs pass and the page no longer shows it. (e2e "C2", from Codex review 2)
- **A database from before per-part booking dependencies.** It is migrated on open, and forgetting still deletes and rewrites. (`review2.test.ts` R2-2)
- **A read racing the forget, and a forget landing between planning and booking.** (`adversarial.test.ts`)
- **Session isolation.** Forgetting in one visitor's session leaves another's untouched. (e2e)
- **Ordinary words.** Memories labelled "Home", "Talking" and "Proof" share words with kept records or with the interface itself. Each one still proves cleanly. (e2e "C3", from Codex reviews 3 and 4)
- **Forgetting after a booking and a stale-memory check.** No deleted id survives in the audit log, and all six proofs pass. (`review2.test.ts` R5-1, e2e "C4")
- **Audit entries written by older versions.** Ids in old `ingest` and `task.booked` entries are rewritten to counts on open. The receipt fails if one survives, even for a memory with no distinctive words. (`review2.test.ts` R4-2, R5-1, R5-2)

## On the live deployment

`scripts/verify-live.mjs` runs scenario C against the deployed service on Render, with PostgreSQL. It covers forget, receipt (14 of 14 checks), ask again, cold reload, old backup, delayed job and fresh export. It then restarts the service and checks, with the same session cookie, that the memory is still forgotten and the old backup is still refused. Results: [evidence/live-verification.json](evidence/live-verification.json) and [evidence/live-verification-restart.json](evidence/live-verification-restart.json).

## What "forgotten" does not cover

The receipt states these limits, and so does [PRIVACY-AND-FORGETTING.md](PRIVACY-AND-FORGETTING.md):

- Copies made outside CAVEAT before the forget, such as a downloaded export, a screenshot or an answer already on screen, cannot be erased. They can only be refused if someone tries to bring them back in.
- On PostgreSQL, deleted rows disappear from queries at once. Their bytes can stay in database pages until vacuum, in the write-ahead log, and in the hosting provider's backups for their retention period. CAVEAT cannot purge provider backups. The byte-level scan of the storage file is done for SQLite only.
- A retrieval that finished before the forget may already have shown the memory.

## Negative control

The naive baseline runs the same steps. Its forget sets a hidden flag, so the search index still finds the memory, the export still carries it, and importing the old backup brings it straight back. The evidence panel shows this side by side.

## How to run it

```bash
npm test                 # includes scenarios, restart, adversarial, review-1 and review-2 regressions
npx playwright test      # C, C2, C3 and C4 in a real browser, desktop and mobile
node scripts/verify-live.mjs https://caveat.onrender.com   # against the deployment (see DEPLOY.md)
```

The test logs from this build are in [evidence/](evidence/).
