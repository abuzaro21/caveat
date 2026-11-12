# Execution state

Last updated: 12 Nov 2026. This file records what is done, what is verified, and what is left for the owner.

## Done and verified

| Item | Evidence |
|---|---|
| Memory engine, policy, forgetting, retention, worker, import/export | `src/`; 65 unit and integration tests |
| Tests on SQLite and on PostgreSQL 16 | 65/65 on each (`docs/evidence/`) |
| Browser tests, desktop and mobile | 22/22 Playwright (`docs/evidence/e2e.log`) |
| UI: assistant, evidence panel, memory inspector, forget dialog, guided demo, naive control | `ui/src/` |
| Clean-clone CI of the release candidate `2361932`: typecheck, build, both test suites, browser tests, `npm audit` (0 vulnerabilities), Docker build and smoke test (non-root image) | `docs/evidence/local-ci.log`: all jobs passed |
| Independent architectures (Claude A, Codex B) | `docs/reviews/claude-architecture-A.md`, `codex-architecture-B.md`, [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md) |
| Codex adversarial reviews 1–5, every finding fixed with a regression test. One further defect, found by Claude while filming, also fixed (R5-1). | `docs/reviews/`. Review 5 was the final release review. Its one fix (R5-2) has not been re-reviewed by Codex. |
| Public repository | https://github.com/abuzaro21/caveat. A secret and history scan was done before publishing, and an anonymous clean clone installs, builds and passes 65/65. |
| Release `v1.0.0` with the film attached | https://github.com/abuzaro21/caveat/releases/tag/v1.0.0 |
| Live deployment on Render (Free web service and Free PostgreSQL 16, isolated CAVEAT workspace) | https://caveat.onrender.com. 26 live checks, then 6 after a restart, all passing. Desktop browser suite 11/11 against the live URL. See [DEPLOY.md](DEPLOY.md). |
| Film: 87.5 s, 1920×1080, 30 fps, H.264/AAC, narration, burned-in and soft captions, logo ending | 12/12 automated checks (`docs/evidence/film-check.json`, `film/contact-sheet.png`). A local Whisper transcript matches the script, with 3.1% word error rate, all from numbers written as digits (`docs/evidence/film-narration-asr.json`). |
| Documentation set | README and `docs/` |

## Known limits

| Item | State |
|---|---|
| GitHub Actions | **BLOCKED BY ACCOUNT BILLING.** Run 43253312033: "The job was not started because recent account payments have failed or your spending limit needs to be increased." No billing settings were changed, and no self-hosted runner was added. The same jobs ran from a clean clone locally (`docs/evidence/local-ci.log`). |
| Free PostgreSQL | Expires 12 Dec 2026, followed by a 14-day grace period. See [DEPLOY.md](DEPLOY.md). |
| `pg` deprecation warning in the service log | Two count queries share one client concurrently (`state()` in `src/memory.ts`). `pg` 8.23.1 (pinned) queues them, so results are correct. Rewrite them as sequential queries before any upgrade to `pg` 9. Severity: LOW. |
| Human review of the film | Not done. Only the automated checks and the Whisper transcript exist. |

## Left for the owner

1. Watch and listen to the film once.
2. Upload it to YouTube as Unlisted, using the text in [SUBMISSION.md](SUBMISSION.md).
3. Submit the DOO form.

## Untouched by this build

KEEL, WATCHSHIFT, Agent Trust, DECIDE, the AI Control Plane, WINK STORE, and their Render workspaces and Docker containers. The WATCHSHIFT film scripts were read as a reference only, and CAVEAT has its own copies in `film/`.
