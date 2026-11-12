# Submission: DOO Builders League

**Status: ready for the owner to submit. Not submitted.** The repository is public, release `v1.0.0` carries the film, and the demo is live. Uploading the film to YouTube and submitting the DOO form are the owner's steps. Neither has happened yet.

## Links

| Item | Link |
|---|---|
| Repository (MIT) | https://github.com/abuzaro21/caveat |
| Release | [`v1.0.0`](https://github.com/abuzaro21/caveat/releases/tag/v1.0.0) |
| Live demo | https://caveat.onrender.com (Render free tier: the first request after idle can take about 30 s) |
| Film download (87.5 s, 1920×1080, H.264/AAC) | https://github.com/abuzaro21/caveat/releases/download/v1.0.0/caveat-film.mp4 |
| Captions | https://github.com/abuzaro21/caveat/releases/download/v1.0.0/caveat-film.srt |
| YouTube (Unlisted) | *Pending owner upload* |

## Entry

| Field | Value |
|---|---|
| Project | **CAVEAT**: memory that knows it might be wrong |
| Tagline | Remember with reasons. Forget with proof. |
| Thesis | [THESIS.md](THESIS.md) |
| AI disclosure | [AI-DISCLOSURE.md](AI-DISCLOSURE.md) |

## One-paragraph description

CAVEAT is agent memory that stores evidence instead of facts. Every memory carries four things: its source, an evidence grade, its freshness against a horizon set for its topic, and its scope. A deterministic policy turns those into Use, Use with caveat, Ask first or Abstain. The agent says "I might be wrong about this" only when the evidence warrants it, and the backend refuses consequential actions that rest on uncertain memory. Forgetting really deletes. It rewrites what was derived from the memory, leaves a content-free tombstone, and issues a receipt with 14 post-commit checks. Six live proofs then show that asking again, reloading, exporting, restoring an old backup, releasing a delayed job, and the page itself cannot bring it back. Every person and record in the demo is fictional.

## Architecture

One Node 24 process serves a React UI and a JSON API. It stores everything in PostgreSQL (on Render) or SQLite (locally), and both stores pass the same test suite. No language model is called at runtime. The policy is deterministic code. Each visitor gets an isolated synthetic household, keyed by an HttpOnly session cookie. Every mutation locks the session row, and the booking gate recomputes its plan inside its own transaction, so a plan the browser saw earlier carries no authority. Claude and Codex produced independent designs, and [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md) records what was taken from each. See also [ARCHITECTURE.md](ARCHITECTURE.md), [MEMORY-MODEL.md](MEMORY-MODEL.md) and [CONFIDENCE-AND-FRESHNESS.md](CONFIDENCE-AND-FRESHNESS.md).

## Forgetting: the failure test and its evidence

[FAILURE-TEST.md](FAILURE-TEST.md) describes it. Before the forget, the demo deliberately makes the two copies a forget usually misses: a signed backup and a delayed job. After the forget:

- the receipt passes 14 of 14 checks;
- asking again abstains;
- a cold reload, a fresh export and the page itself show no trace;
- the old backup is refused, and the delayed job is fenced;
- after a server restart, the memory is still forgotten and the backup is still refused.

| Evidence | Where |
|---|---|
| 65/65 tests on SQLite and 65/65 on PostgreSQL 16 | `docs/evidence/test-sqlite.log`, `test-postgres.log` |
| 22/22 browser tests, desktop and mobile | `docs/evidence/e2e.log` |
| Clean-clone CI: typecheck, build, tests, browser tests, `npm audit` (0 vulnerabilities), Docker build and smoke | `docs/evidence/local-ci.log` |
| Live service: 26 checks, then 6 after a restart, all passing | `docs/evidence/live-verification.json`, `live-verification-restart.json` |
| Five Codex adversarial reviews, each finding fixed with a regression test | [reviews/](reviews/) |

**Limits, stated on every receipt.** Copies made outside CAVEAT before the forget cannot be erased, only refused if someone brings them back. On PostgreSQL, deleted bytes can remain in database pages until vacuum, in the write-ahead log, and in the provider's backups. A retrieval that finished before the forget may already have shown the memory.

## Two-year thesis

From [THESIS.md](THESIS.md): agents will be judged less by how much they remember than by how well they know the limits of what they remember. **Prediction for 2028:** by the end of 2028, at least one major consumer AI assistant will show users the source and last-confirmed date of a remembered personal fact at the moment it acts on it, and will let them delete that memory with a verifiable receipt.

## AI disclosure

Built with **Claude Opus 5.5** (Claude Code): design A, implementation, tests, UI, documentation and the film script. **GPT-6.1 Sol** (Codex CLI, read-only sandbox) produced the independent design B and five adversarial reviews. The session ids are in [AI-DISCLOSURE.md](AI-DISCLOSURE.md). The narration voice is Kokoro-82M, an open-weights TTS model run locally. CAVEAT itself calls no model. No human review of the code or the film is claimed.

## Ready-to-paste form notes

- **Project name:** CAVEAT
- **One line:** Agent memory that knows it might be wrong: every memory carries its source, evidence grade, freshness and scope, and forgetting comes with proof.
- **Repository:** https://github.com/abuzaro21/caveat
- **Live demo:** https://caveat.onrender.com
- **Video:** *(the Unlisted YouTube link)*. Direct file: https://github.com/abuzaro21/caveat/releases/download/v1.0.0/caveat-film.mp4
- **What to try (2 minutes):** click "Book the sofa" to see "I might be wrong about this." and the server refusing to book. Answer "Afternoons", and it books. Click "Jump 30 days ahead", then "Send the repair to the office": a stale memory is re-checked. Click "Forget the private location", then "Run the proofs".
- **Built with:** Node 24, TypeScript, React 19, PostgreSQL 16 / SQLite, Playwright, Docker, Render (free). Claude Opus 5.5 with Claude Code; GPT-6.1 Sol with Codex CLI for independent design and reviews.

## Video (for the owner to paste when uploading)

**Title:** CAVEAT: memory that knows it might be wrong (DOO Builders League)

**Description:**

> CAVEAT is agent memory that stores evidence, not facts. Every memory carries its source, an evidence grade, its freshness and its scope. When the evidence is weak, stale or contested, the agent says "I might be wrong about this" and asks before acting. When you ask it to forget, it deletes, and proves it.
>
> In the film:
> - **A.** A conflicting delivery preference blocks a booking until Maya answers.
> - **B.** A memory past its horizon is re-checked before acting.
> - **C.** A private memory is forgotten, and six live proofs show nothing brings it back, including an old backup and a delayed job.
>
> Every frame is a real capture of the running build. The household is fictional, and the narration is synthetic (Kokoro-82M).
>
> Live demo: https://caveat.onrender.com
> Code (MIT): https://github.com/abuzaro21/caveat
> Built with Claude Opus 5.5 (Claude Code), with independent design and adversarial reviews by GPT-6.1 Sol (Codex CLI).

**Tags:** CAVEAT, AI agents, agent memory, AI memory, uncertainty, provenance, privacy, right to be forgotten, data deletion, LLM agents, Claude, Claude Code, Codex, DOO Builders League, open source, TypeScript, React, PostgreSQL

**Captions:** upload `caveat-film.srt` from the release. They are also burned into the picture.

**Visibility:** Unlisted.

## Owner checklist

- [ ] Watch and listen to the film once. No human review has been done. Record it in AI-DISCLOSURE.md if you do one.
- [ ] Upload the film to YouTube as **Unlisted**, with the title, description, tags and captions above.
- [ ] Submit the DOO form with the repository, live demo and video links.
- [ ] Before 12 Dec 2026, decide whether to recreate the free database (see [DEPLOY.md](DEPLOY.md)).
