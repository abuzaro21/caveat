# Architecture decisions

Two architectures were written independently before any code:

- **Architecture A** by Claude (Opus 5.5): [reviews/claude-architecture-A.md](reviews/claude-architecture-A.md).
- **Architecture B** by Codex (`gpt-6.1-sol`, run through the Codex CLI in a read-only sandbox): [reviews/codex-architecture-B.md](reviews/codex-architecture-B.md). The brief it was given is [reviews/codex-architecture-B-brief.md](reviews/codex-architecture-B-brief.md).

Claude wrote A before reading B. The decisions below record which design won each question, and why.

| # | Question | A (Claude) | B (Codex) | Decision |
|---|---|---|---|---|
| 1 | Strength of a memory | Levels from source kind (high, medium, low) with ± adjustments | **Evidence grades**: unsupported < reported < corroborated < authoritative, with no probabilities | **B.** Grades say what kind of support exists. "Medium" says nothing a reader can check. |
| 2 | Who may establish a fact | Fixed authority per source kind | **Authority depends on the predicate.** The owner establishes their preference but not courier capacity. | **B.** This is the rule that lets the courier contest a preference without ever overriding it (`authoritativeKinds` in the registry). |
| 3 | Corroboration | +1 step for an independent source | Independent original sources only; copies count once; unknown independence earns no credit | **B**, and tightened after review 1. Independence must be server-attributed, so an unsigned import's declared lineage earns nothing. |
| 4 | Freshness numbers | Per-predicate review-after | Per-consequence (advice vs action) limits | **Both.** Each predicate has an *action horizon* and an *advice horizon*. Our horizons are longer than B's (B used 24 hours for delivery preferences), which suits a household-preference demo; the values are documented assumptions. |
| 5 | Tombstones | HMAC fingerprint of the deleted value | **No value fingerprints.** Revoke the topic namespace. | **B.** A fingerprint of a low-entropy value (a weekday and an hour range) can be dictionary-attacked. Tombstones are topic-level: `block` never relearns; `before` drops everything older and relearns only from new statements. |
| 6 | Serialisation | A generation counter checked by reads | **Every mutation serialised on the session row**, with the gate recomputing inside its own transaction | **B.** `tx(sid)` locks the session row (PostgreSQL `FOR UPDATE`; SQLite `BEGIN IMMEDIATE`). The revision counter from A is kept to fence the worker and the cache. |
| 7 | Imports | Check tombstones by fingerprint | **Server-signed, session-bound envelopes.** Unsigned data is a third-party report. | **B.** The HMAC covers the body and a session binding, so a tampered or cross-session export downgrades to unsigned. |
| 8 | Delayed work | Discard results from older generations | Jobs carry **identifiers and revision only**, then rehydrate under the lock | We first built A's version: a job that captured content and was fenced. Codex review 1 (finding 5) showed the captured plaintext sat in the inbox until release, so we switched to B's design. |
| 9 | Outcome names | USE, CAVEAT, ASK, ABSTAIN | USE, CAVEAT, ASK, ABSTAIN | Same four. The API says `QUALIFY` instead of `CAVEAT`, because the product is called CAVEAT. The UI label is "Use with caveat". |
| 10 | Name | HEDGE (crowded: HedgeDoc, hedge-dev) | Proofmolt; also "Perhaps Ledger" | **CAVEAT**, with B's "Perhaps Ledger" adapted into the tagline *Remember with reasons. Forget with proof.* A caveat is what the agent adds when it might be wrong. The logo is a proofreader's caret ‸, the mark for "something is missing here". |
| 11 | Scope of private-location revocation | Per claim or category | The whole predicate, across scopes | **B**: topic-level tombstones. |

## Things neither design had, added during build

- **Ingestion sequence (`seq`) as the deterministic tie-break.** Evidence observed at the same virtual instant would otherwise order nondeterministically.
- **Booking text stored as parts with evidence dependencies**, so a forget removes derived text by dependency instead of by word matching. Added after review 1, finding 4.
- **Per-slot hold checks.** Added after review 1, finding 8.
- **SQLite storage compaction** (`secure_delete` plus a `wal_checkpoint(TRUNCATE)`), so a hard kill after a forget leaves no pre-forget page images in the WAL. The restart test byte-scans both files.
