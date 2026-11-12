# Architecture A (Claude, written before reading Codex's Architecture B)

## Name candidates

| Name | Meaning | Notes |
|---|---|---|
| **HEDGE** | to hedge = to qualify a claim with appropriate uncertainty | Short, pronounceable; "hedge fund"/"hedge" collisions are generic words, not memory products |
| **PALIMPSEST** | a page scraped and rewritten, earlier text still faintly visible | Beautiful metaphor for supersession; hard to spell, long |
| **CAVEAT** | "a warning attached to a claim" | Directly what the engine produces; `caveat` is also the name of a JS macaroon lib and a few small tools |

Pick: **HEDGE**? Concern: weakly signals "memory". Decide after Codex proposals.

## Central concept

A memory is a **claim** derived from one or more **evidence** records, scoped to a subject + context, with a policy-
driven lifecycle. The agent never reads raw memory; it reads a **Verdict** computed at query time:
`USE | CAVEAT | ASK | ABSTAIN`, with reasons. Consequential actions require `USE` from the backend gate; the UI and the
narrator cannot override it.

## Data model (SQLite / PostgreSQL, same DDL)

- `sessions(id, created, last_active, clock_offset_ms)` — one synthetic tenant per visitor; virtual clock per session.
- `evidence(id, session, subject, kind, authority, observed_at, recorded_at, content_ref)` — who said it and when.
  `kind ∈ user_statement | user_correction | trusted_import | observed_event | third_party | model_inference`.
- `claims(id, session, subject, predicate, scope_json, value_json, evidence_id, valid_from, valid_until, status,
  version, supersedes, sensitivity, purpose)` — mutable content table; value lives here only.
- `claim_index(claim_id, session, term)` — derived keyword index for retrieval (deleted with the claim).
- `uses(claim_id, session, task, at, verdict)` — "where was this used".
- `tombstones(session, subject, predicate, scope_key, fingerprint, revoked_at, reason)` — non-content; fingerprint =
  HMAC(session_secret, canonical(predicate,scope,value)); session_secret is random per session and deleted with session.
- `audit(session, seq, at, op, claim_id, detail_json)` — metadata only, never values.
- Receipt = a row in audit + a computed check over all tables at receipt time.

## Confidence (categorical, explainable)

Base level from source kind: user_correction=high, user_statement=high, trusted_import=medium, observed_event=medium,
third_party=low, model_inference=low. Adjust: corroborated by an independent source (+1 step max high), contested by
an unresolved conflict (→ "contested"), stale (→ capped at low for consequential use), scope partial match (−1).
Each step emits a reason string. No percentages.

## Freshness

Per-predicate policy table: `delivery.window` reviewAfter 90d, `location.current` validUntil event end, `style.tone`
reviewAfter 365d, inferred anything reviewAfter 30d. States: fresh → review_due → stale → (retention) expired.
Consequential tasks require fresh; informational answers may use review_due with a caveat.

## Contradiction

Same subject+predicate, overlapping scope (scope keys compared field by field: a claim scoped `location=home` does not
conflict with `location=office`), overlapping validity interval, different value → conflict. Then:
- newer evidence with authority ≥ older → supersede if it is an explicit correction, else "contested".
- lower authority than the incumbent → recorded as dissent; incumbent stays, verdict CAVEAT/ASK depending on action.
- user_correction always resolves within its scope and records `supersedes`.

## Retrieval

query(subject, need: {predicate, scope}, action: informational|consequential) → candidates (scope + consent filter
first, then match) → evaluate freshness/conflict → rank → Verdict with: claims, sources, confidence reasons, freshness,
scope match, conflict set, decision, sentence. "I might be wrong about this." is emitted iff decision ∈ {CAVEAT, ASK}
because of conflict/staleness/low confidence.

## Agent task

`scheduleDelivery(session)` needs `delivery.window` for scope `home`. Gate: only USE lets the booking row be written.
ASK returns a question; the user's answer is ingested as `user_correction` and the task is re-run.

## Forgetting

`forget(claim or category)`: one transaction: delete claim rows, index rows, uses rows, evidence content if no other
claim references it; insert tombstone + audit(op=revoke, no content). Ingestion and import check tombstones by
fingerprint and by (subject,predicate,scope) for category revocations → reject with "revoked" reason. Session
generation counter bumped on revoke; retrieval reads claims and generation in one transaction; in-flight results with
an older generation are discarded before being returned. Receipt = post-commit verification query counting remaining
rows in every table for that claim id + fingerprint scan of export.

## Scenarios: A (conflict) / B (stale with virtual clock) / C (revocation + restart + import replay).

## Stack: Node 24 TS (type stripping), node:sqlite + pg, React/Vite, SSE optional, Playwright, Docker, Render free.
