# Execution state

Last updated: 12 Nov 2026. This file records what is done, what is verified, and what is waiting on the owner.

## Done and verified locally

| Item | Evidence |
|---|---|
| Memory engine, policy, forgetting, retention, worker, import/export | `src/`; 63 unit and integration tests |
| Tests on SQLite and on PostgreSQL 16 | 63/63 on each (`docs/evidence/`) |
| Browser tests, desktop and mobile | 20/20 Playwright (`docs/evidence/`) |
| UI: assistant, evidence panel, memory inspector, forget dialog, guided demo, naive control | `ui/src/` |
| Independent architectures (Claude A, Codex B) | `docs/reviews/claude-architecture-A.md`, `codex-architecture-B.md`, [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md) |
| Codex adversarial reviews 1–4, all findings fixed with regression tests | `docs/reviews/` |
| Docker image builds, runs as non-root, serves the UI and passes health checks | local CI log |
| Documentation set | README and `docs/` |

## Blocked or waiting on the owner

| Item | State | What unblocks it |
|---|---|---|
| GitHub Actions CI | **BLOCKED BY ACCOUNT BILLING.** Run 43253312033: "The job was not started because recent account payments have failed or your spending limit needs to be increased." | Owner resolves billing. No billing settings were changed, and no self-hosted runner was added. The equivalent CI runs locally (`scripts/ci-local.sh`), and its log is in `docs/evidence/`. |
| Live deploy on Render (free) | Not deployed | Owner creates an isolated CAVEAT workspace and re-authenticates Render. See [DEPLOY.md](DEPLOY.md). |
| Public repository and release | Repository is private | Owner authorizes making it public |
| Video upload and DOO form | Not done | Owner's accounts and authorization. See [SUBMISSION.md](SUBMISSION.md). |
| Human listening review of the film | Not done | Only automated audio and video checks exist |

## Untouched by this build

KEEL, WATCHSHIFT, Agent Trust, DECIDE, the AI Control Plane, WINK STORE and their Render workspaces and Docker containers. The WATCHSHIFT film scripts were read as a reference only, and CAVEAT has its own copies in `film/`.
