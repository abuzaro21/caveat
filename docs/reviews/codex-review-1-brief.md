You are an independent adversarial security and correctness reviewer (read-only) for CAVEAT, an agent-memory engine for the challenge "Memory That Knows It Might Be Wrong". Read src/*.ts and test/*.ts in this repository. docs/reviews/codex-architecture-B.md is your own earlier architecture; docs/reviews/claude-architecture-A.md is Claude's. The engine adopted your evidence grades, content-free tombstones (no value fingerprints), session-row serialisation and backend recomputation at booking.

Attack the implementation, not the style. For each finding give: severity (BLOCKER/HIGH/MEDIUM/LOW), file:line, a concrete reproduction (inputs/steps), the violated guarantee, and a minimal fix. Only report real defects you can justify from the code. Focus on:
1. Confidence/grade: can any input path inflate authority (client-declared sourceKind, signed-import abuse, lineage spoofing to fake corroboration, label spoofing)?
2. Reconciliation: context-specific facts misclassified as contradictions; newer low-authority evidence overriding corrections; ties; general-vs-specific scope; validity intervals; opposing-stance evidence.
3. Freshness: can old evidence become fresh (import observedAt, clock manipulation, reconfirmation semantics)?
4. Forgetting: any controlled copy that survives forget (tables, index, summaries, bookings.reason, receipts, audit, decision cache, worker inbox, export, SQLite WAL/pages); can deleted content be resurrected (signed/unsigned import, replay after restart, delayed worker, retention)? Is the receipt truthful? Do tombstones leak content?
5. Races: revocation vs in-flight retrieval/ask/plan/book, concurrent corrections, SQLite chain mutex vs PostgreSQL FOR UPDATE semantics (e.g. reads in tx(null) that are not locked; ask() and state() paths), cache population after purge.
6. Isolation: cross-session or cross-person (maya/sam) leakage via ask(), state(), export, decisions' considered lists, naive baseline.
7. HTTP: cookie/session handling, CSRF, rate limiting and X-Forwarded-For trust, static path traversal, error messages leaking content, logs.
8. Whether the agent's behaviour truly depends on the memory state (is "I might be wrong about this." ever emitted without warrant or missing when warranted?).
End with a verdict: SHIP / SHIP WITH FIXES / DO NOT SHIP, and the top 5 fixes in priority order. Keep it under 1800 words.
