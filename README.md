<p align="center"><img src="ui/public/logo.svg" width="72" alt="CAVEAT logo: an amber proofreader's caret over a broken baseline"></p>

<h1 align="center">CAVEAT</h1>
<p align="center"><i>Remember with reasons. Forget with proof.</i></p>

CAVEAT is agent memory that knows it might be wrong. It does not store "facts". It stores **evidence**, and every piece of evidence carries four things:

- **where it came from:** the source kind, a label and a lineage;
- **how strong it is:** a documented *evidence grade*, not a made-up percentage;
- **how fresh it is:** its age against per-topic horizons, measured on a virtual clock;
- **what it applies to:** a person and a place.

When the agent recalls something, CAVEAT recomputes a verdict from that evidence: **Use**, **Use with caveat**, **Ask first**, or **Abstain**. The agent says *"I might be wrong about this."* only when the evidence warrants it. The backend refuses any consequential action that rests on uncertain memory. Forgetting deletes data and proves it: a receipt, fourteen post-commit checks, and six live proofs, including that an old backup and a delayed job cannot bring the memory back and that the page itself no longer shows it.

- **Live demo:** see [docs/DEPLOY.md](docs/DEPLOY.md). It runs on Render's free tier, so the first request after idle can take about 30 s.
- **All data is fictional.** Every visitor gets an isolated synthetic household (Maya and Sam) on a virtual clock that starts on Thursday 12 Nov 2026.

## The three scenarios

| | What happens | What CAVEAT does |
|---|---|---|
| **A: Conflicting preference** | In July, Maya said she prefers deliveries to her home in the **morning**. Since late October, the courier's log has recorded three failed morning attempts, and a model guessed "evenings". | Before booking the sofa it says: *"I might be wrong about this. You told me mornings on 14 Jul 2026, but ParcelCo delivery log has 3 newer reports, 28 Oct – 10 Nov 2026, suggesting mornings may no longer be right."* Nothing is booked (the server returns HTTP 409) until Maya answers. Her answer is recorded as an explicit correction and supersedes everything older. The model's guess is shown as weak dissent and never wins. |
| **B: Stale memory** | Advance the clock by 30 days. Maya's office days were last confirmed 113 days ago, and that topic is re-checked after 90 days. | The laptop-repair task asks *"Is this still right?"* instead of acting. A one-tap reconfirmation makes the memory fresh again. Her home city, confirmed almost two years ago, is still fine: a home city has a 5-year horizon. Freshness depends on the topic. |
| **C: Privacy revocation** | Maya forgets her private recurring location, a physiotherapy appointment. | The forget deletes the evidence rows and their index entries and usage records. It rewrites booking text and summaries derived from them, purges the cache and leaves a content-free tombstone. A content-free receipt lists 14 verification checks. Then six live proofs run: ask again, cold reload, a fresh export, restore the **signed backup taken before the forget**, release a **delayed job queued before it**, and search the page itself for any trace. Each proof passes. A test also stops and restarts the server, and byte-scans the SQLite file and WAL for the deleted words. |

The **naive baseline** (`/api/naive`) runs the same inputs through "latest text wins" memory. It books evenings on a model's guess. Its "forget" only hides the row, so the search index and export still hold it and an old backup restores it. It is a negative control, shown in the evidence panel.

## How it decides, in one paragraph

Every query runs the same deterministic policy ([src/policy.ts](src/policy.ts)). There is no language model and no randomness.

1. **Access.** Only the person a memory is about may inspect it.
2. **Consent.** Sensitive memories are used only for the purposes the person agreed to.
3. **Revocation.**
4. **Scope.** "Mornings at home" is a different fact from "mornings at the office", and Sam's preference is not a contradiction of Maya's.
5. **Validity interval.**
6. **Corrections.** An explicit correction supersedes everything older.
7. **Grading.** Authority depends on the topic. The courier is never *authoritative* about what Maya wants. Corroboration needs two independent, server-attributed sources, and repeated copies count once.
8. **Conflict.** Newer, attributable disagreement contests the memory. A newer guess does not.
9. **Freshness.** The age of the confirming evidence is compared with per-topic action and advice horizons.

A consequential action needs strong, fresh, uncontested evidence. Anything less asks first.

## Run it

Requires Node 24.13 or later (native TypeScript, `node:sqlite`).

```bash
npm ci
npm run build          # UI -> public/
npm start              # http://localhost:3000, SQLite in data/
npm test               # 63 tests: policy, scenarios, adversarial, HTTP, restart, review regressions
npm run test:e2e       # Playwright, desktop + mobile (20 tests)
```

To run the same suite on PostgreSQL, set `CAVEAT_TEST_DATABASE_URL=postgres://…` before `npm test`. To serve from PostgreSQL, set `DATABASE_URL` (see [docs/DEPLOY.md](docs/DEPLOY.md)).

## Documents

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Write, retrieve and forget paths, with diagrams |
| [Architecture decisions](docs/ARCHITECTURE-DECISIONS.md) | Claude's design A vs Codex's design B, and what we took from each |
| [Memory model](docs/MEMORY-MODEL.md) | Evidence, sources, scope, validity, tombstones |
| [Confidence and freshness](docs/CONFIDENCE-AND-FRESHNESS.md) | Grades, horizons, outcomes, the exact rules |
| [Privacy and forgetting](docs/PRIVACY-AND-FORGETTING.md) | What deletion deletes, what it keeps, what it cannot reach |
| [Failure test](docs/FAILURE-TEST.md) | Scenario C end to end, including restart and resurrection attempts |
| [Security](docs/SECURITY.md) | Threat model, controls, adversarial review history |
| [Thesis](docs/THESIS.md) | Why memory should hedge, and a prediction for 2028 |
| [AI disclosure](docs/AI-DISCLOSURE.md) | Which models did what |
| [Deploy](docs/DEPLOY.md) · [Submission](docs/SUBMISSION.md) · [Execution state](docs/EXECUTION_STATE.md) · [Evidence](docs/evidence/) | |

## License

MIT. See [LICENSE](LICENSE).
