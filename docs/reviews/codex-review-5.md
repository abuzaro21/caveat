# Codex review 5: final release review (verbatim)

Model: `gpt-6.1-sol` (from Codex CLI runtime metadata). Sandbox: read-only. Session: `01a1d126-8699-7e20-bba1-b1b80288ff9f`. Commit reviewed: `bf1d5f0`. Brief: [codex-review-5-brief.md](codex-review-5-brief.md). Our response: [codex-review-5-response.md](codex-review-5-response.md).

The final message is reproduced unchanged below.

---

**Verdict: DO NOT SHIP.**

Reviewed `bf1d5f0`. All 64 supplied SQLite tests passed.

1. **MEDIUM — Receipts skip identifier verification when there are no distinctive terms.**  
   The `if (markers.length)` branch at [memory.ts:419](E:/doo/caveat/src/memory.ts:419) encloses all four table scans, including the new deleted-ID checks at [memory.ts:430](E:/doo/caveat/src/memory.ts:430). An ordinary memory such as `Home` produces no distinctive terms, so verification silently drops from 14 checks to 10. Deleted identifiers are therefore unchecked in summaries, bookings, audit entries and receipts.

   **Reproduction:** In an in-memory SQLite session:
   - Forget the seeded private location using `before`.
   - Ingest a private location with label and excerpt `Home`.
   - As a negative-control fixture, preserve its evidence ID in an old-format ingest audit entry: `{"stored":[id]}`.
   - Forget the private location using `block`.

   **Actual:** `verified: true`, 10 checks, and the deleted ID remains in the audit returned by `state()`. The identical fixture using `Gym` runs 14 checks and correctly returns `verified: false`, with “Deleted content in audit” failing.

   This reproduces a verifier defect; it does not establish that the startup migration leaves these entries behind. Run the four table scans and identifier checks regardless of whether distinctive terms exist; condition only the term-dependent checks.

Not run: PostgreSQL runtime checks or browser E2E; browser launch failed with sandbox `EPERM`. No repository files were modified.

