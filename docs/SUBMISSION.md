# Submission: DOO Builders League

**Status: prepared, not submitted.** Uploading the film and submitting the DOO form both need the owner's accounts and authorization. Neither has happened yet.

## Entry

| Field | Value |
|---|---|
| Project | **CAVEAT**: memory that knows it might be wrong |
| Tagline | Remember with reasons. Forget with proof. |
| Repository | https://github.com/abuzaro21/caveat (MIT) |
| Live demo | *Pending: see [DEPLOY.md](DEPLOY.md)* |
| Film | `film/out/caveat-film.mp4`, published as a release asset. Public video link *pending owner upload*. |
| Thesis | [THESIS.md](THESIS.md) |
| AI disclosure | [AI-DISCLOSURE.md](AI-DISCLOSURE.md) |

## One-paragraph description

CAVEAT is agent memory that stores evidence instead of facts. Every memory carries four things: its source, an evidence grade, its freshness against a horizon set for its topic, and its scope. A deterministic policy turns those into Use, Use with caveat, Ask first or Abstain. The agent says "I might be wrong about this" only when the evidence warrants it, and the backend refuses consequential actions that rest on uncertain memory. Forgetting really deletes. It rewrites what was derived from the memory, leaves a content-free tombstone, and issues a receipt with 14 post-commit checks. Six live proofs then show that asking again, reloading, exporting, restoring an old backup, releasing a delayed job, and the page itself cannot bring it back. Every person and record in the demo is fictional.

## How it meets the brief

| Requirement | Where |
|---|---|
| Provenance, confidence (evidence grade), freshness and scope on every memory | [MEMORY-MODEL.md](MEMORY-MODEL.md), [CONFIDENCE-AND-FRESHNESS.md](CONFIDENCE-AND-FRESHNESS.md) |
| Uncertainty-aware retrieval and abstention | `src/policy.ts`; scenario A |
| Policies for stale, contradicted, corrected and revoked memories | Scenarios A and B; `test/policy.test.ts` |
| Real forgetting | [PRIVACY-AND-FORGETTING.md](PRIVACY-AND-FORGETTING.md), [FAILURE-TEST.md](FAILURE-TEST.md) |
| A warranted "I might be wrong about this." | Scenario A: a newer courier record contests a July statement |
| A backend-enforced agent task | `POST /api/book` returns 409 unless every needed memory is USE |
| Memory inspector and privacy controls | The Memory column, and the Forget dialog with two deletion modes |
| Scenarios A, B and C | README; `test/scenarios.test.ts`; `e2e/caveat.spec.ts` |
| Naive baseline as a negative control | `src/naive.ts`, shown in the evidence panel |
| Independent architectures and adversarial reviews | [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md), [reviews/](reviews/) |

## Video text (for the owner to paste when uploading)

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
> Code (MIT): https://github.com/abuzaro21/caveat
> Built with Claude Opus 5.5 (Claude Code), with independent design and adversarial reviews by GPT-6.1 Sol (Codex CLI).

**Captions:** upload `film/caveat-film.srt`. They are also burned into the picture.

## Checklist before submitting (owner)

- [ ] Live URL works, and the post-deploy checks in DEPLOY.md pass
- [ ] Repository is public, with release `v1.0.0` tagged and the film attached
- [ ] Watch and listen to the film once. No human review has been done so far; record it in AI-DISCLOSURE.md if you do one.
- [ ] Upload the video and paste the description above
- [ ] Submit the DOO form with the repository, live URL and video links
