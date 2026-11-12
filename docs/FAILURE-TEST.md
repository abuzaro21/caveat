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

## Negative control

The naive baseline runs the same steps. Its forget sets a hidden flag, so the search index still finds the memory, the export still carries it, and importing the old backup brings it straight back. The evidence panel shows this side by side.

## How to run it

```bash
npm test                 # includes scenarios, restart, adversarial, review-1 and review-2 regressions
npx playwright test      # C and C2 in a real browser, desktop and mobile
```

The test logs from this build are in [evidence/](evidence/).
