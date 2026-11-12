**ARCHITECTURE B — Proofmolt**

A memory layer that treats remembering as conditional permission to answer or act. Evidence, applicability, freshness, and consent remain separate; a strong source cannot compensate for revoked permission.

**1. Names**

| Proposal | Tagline |
|---|---|
| **Proofmolt** | Keep the evidence. Shed the assumption. |
| **Footnote Finch** | Every memory has a source—and a limit. |
| **Perhaps Ledger** | Remember with reasons. Forget with proof. |

**Pick: Proofmolt.** It suggests both evidence and shedding outdated knowledge. I know no obvious exact-name product collisions; preliminary searches found none. “Ledger” has a prominent existing association, making that proposal less distinctive.

**2. Architecture and invariants**

One Node.js 24 service serves the React/Vite build and a deterministic agent. TypeScript uses erasable syntax; Vite handles TSX, and `tsc --noEmit` checks types separately because native stripping performs no type checking. ([Node documentation](https://nodejs.org/docs/latest-v24.x/api/typescript.html))

Use `node:sqlite` locally and in tests; PostgreSQL with a small driver on Render. Shared policy functions operate on database records, with explicit transaction implementations for each database.

| Record | Responsibility |
|---|---|
| Session | Server-generated identity, credential, real expiry, virtual clock, revision |
| Subject | Opaque identity within one session; no automatic entity merging |
| Evidence | Structured assertion, source identity/class, original-source lineage, observation and ingestion times |
| Claim | Subject, predicate, typed value, scope, validity interval, supporting/opposing evidence, correction relationship |
| Derived index | Rebuildable subject/predicate/scope-to-claim lookup |
| Tombstone | Revoked storage namespace, revision, operation ID; no deleted value |
| Receipt/audit | Operation, commit time, revision, purge counts, policy version; no content |

Every retrievable claim includes provenance, computed evidence grade, temporal validity, and scope.

Architecture snapshot:

- **Write:** authenticated session → schema/authority validation → tombstone check → evidence and claims → index → revision increment.
- **Retrieve:** session/scope filter → privacy check → evidence reconciliation → freshness/action policy → decision envelope and cited response.
- **Forget:** lock session → install tombstone → purge evidence, claims, dependencies and index → increment revision → commit receipt.

Numbered invariants:

1. Every relationship includes session identity; cross-session references are rejected.
2. Imports cannot declare themselves user corrections or trusted sources.
3. Index entries never independently authorize an answer.
4. Missing scope, validity, or provenance prevents actionable use.
5. Reads, writes, forgetting, and simulated actions serialize through the session record.
6. Tombstones and revision checks apply to imports, index rebuilds, and delayed work.
7. Deletion completion is reported only after its transaction commits.

**3. Evidence strength without invented probabilities**

Use reproducible **evidence grades**, not “87% confident”:

- **Unsupported:** missing provenance, invalid structure, or unauthenticated asserted authority.
- **Reported:** attributable indirect statement.
- **Corroborated:** matching direct reports from independently identified original sources.
- **Authoritative:** direct statement from an actor entitled to establish this predicate—for example, the session owner’s delivery preference.

Inputs are source authentication, predicate-specific authority, directness, validation, and source independence. Copies share an original-source identifier and count once. Unknown independence provides no corroboration credit.

A correction adds an explicit authority relationship; it does not manufacture factual certainty. A user can establish their preference, but cannot establish courier capacity.

Publish the grade decision table, rationale, policy version, and counterexamples. Tests verify every transition. These grades describe support; freshness, conflict, and consent independently constrain use. Numerical probabilities require subsequent empirical calibration.

**4. Freshness depends on the consequence**

Store observation time, ingestion time, and claimed validity separately. Importing an old statement does not refresh it.

| Predicate | Advisory use | Simulated action |
|---|---|---|
| Delivery preference | Caveat after 30 days | Require authoritative evidence within 24 hours |
| Pickup availability | Valid for 15 minutes | Same limit; expired evidence blocks |
| Private location | Declared validity, maximum 24 hours | Require current consent and applicable fresh evidence |

These are documented demo assumptions, not universal truths.

Effective expiry is the earlier of source validity and policy expiry. Historical questions evaluate historical applicability explicitly.

A persisted, monotonic **virtual clock** advances evidence time for scenario B. Session expiry, credentials, and rate limits use real server time. Rewinding the browser cannot revive a claim.

**5. Contradiction and reconciliation**

Compare subject, predicate, scope, and overlapping validity before declaring contradiction:

- Different subjects or delivery scopes: separate claims.
- Non-overlapping periods: historical change.
- Incompatible values with overlapping applicability: conflict.
- Unclear time or scope: unresolved applicability; ask.
- Different source accounts: preserve both with their authority and lineage.
- Explicit owner correction: supersede the identified claim for the stated scope and effective period.

Recency breaks ties only where the predicate policy permits it. A later low-authority import cannot override an owner correction. Retain it as a disputed report; it cannot renew, replace, or become an independent confirmation of that correction.

Corrections preserve historical evidence until deletion. Revocation removes it.

**6. Retrieval and backend decisions**

Inputs: authenticated session, subject, question, scope, virtual time, requested action and consequence.

| Decision | Condition | Behavior |
|---|---|---|
| **USE** | Applicable, permitted, sufficiently supported and fresh | Answer with evidence |
| **CAVEAT** | Evidence permits advisory use but has a material limitation | Explain limitation; no consequential action |
| **ASK** | User can resolve conflict, missing scope, or freshness | Request targeted clarification |
| **ABSTAIN** | Revoked, absent, unauthorized, or insufficient evidence | Withhold claim and action |

Each response carries evidence IDs and summaries, dates, scope, grade, conflicts, policy reasons, and session revision.

Scenario A:

> “I might be wrong about this. Your earlier instruction says ‘front desk’; a newer delivery report says ‘side entrance.’ I cannot establish your current preference, so I have not finalized the simulated delivery.”

Both sources appear beside the response. The visitor selects an explicit correction; the agent acknowledges it and continues.

The finalization endpoint independently locks the session, retrieves current evidence, and recomputes policy before inserting the simulated delivery. Browser flags and previously issued decisions convey no authority. Idempotency prevents duplicate deliveries.

**7. Forgetting and resurrection prevention**

For the demo, revoking private location permanently disables the **entire location predicate across scopes in that session**. This deliberately broad boundary avoids retaining the location merely to recognize it later.

Use an opaque session ID plus fixed predicate ID for the tombstone. **Do not fingerprint deleted values.** Unkeyed hashes expose low-entropy locations to dictionary attacks; keyed HMAC reduces exposure but remains vulnerable to key compromise, comparison oracles, and normalization gaps. Namespace revocation needs none of these content comparisons.

Within one transaction:

1. Install the tombstone.
2. Delete all affected evidence, claims, conflict/correction relationships, derived entries, and dependent action payloads.
3. Increment revision and commit a content-free receipt.

No durable transcript, response cache, raw import archive, or content export exists. The UI clears affected responses, rejects older revisions, and uses `Cache-Control: no-store`.

Imports are server-signed, session-bound structured envelopes. Replayed imports encounter both revision checks and the permanent namespace denial. Delayed work carries identifiers and revision, then rehydrates under the same lock; stale work cannot restore captured values.

A retrieval committed before revocation may already have transmitted information; packets and screenshots cannot be recalled. Retrievals ordered after revocation expose none. The inspector distinguishes that boundary.

Restart reloads PostgreSQL tombstones before serving sessions. Missing database state fails closed; old credentials never trigger reseeding. Session expiry purges remaining content, then retires credentials; unknown sessions cannot be recreated through replay.

Receipts prove application-row and index removal, not physical erasure from provider storage, database WAL, or previously downloaded copies.

**8. Adversarial challenges and tests**

| Silent failure | Required test |
|---|---|
| Confidence is cosmetic | Keep wording constant; weaken evidence; action must become blocked |
| Scope mistaken for contradiction | Different delivery scopes coexist without conflict |
| Recency defeats correction | Newer imported disagreement cannot replace owner correction |
| Copies inflate confidence | Reimport one source repeatedly; grade stays unchanged |
| Old imports become “fresh” | New ingestion time leaves observation expiry unchanged |
| Clock manipulation revives evidence | Advance across expiry; rollback attempt fails |
| Index retains deleted knowledge | Query every affected base and derived table; all content counts are zero |
| Replay resurrects location | Replay old envelope and delayed worker, including after restart |
| Revocation races retrieval/action | Barrier-controlled transactions verify both serialization orders |
| Cross-session ID substitution | Borrow another visitor’s IDs; reads and writes fail |
| Imported prompt injection | Instruction-like text is rejected as invalid data; authority never changes |
| Logs/caches leak content | Unique synthetic marker scan across captured logs and application storage |
| Browser bypasses action policy | Direct finalization request still fails |
| SQLite conceals PostgreSQL bugs | Run the same contract suite against both databases |

**9. Submission scope and cuts**

Keep the inspector: evidence cards, validity timeline, decision reasons, correction controls, revoke button, and deletion receipt.

Deliver one repository containing policy documentation, migrations, tests, architecture snapshot, thesis, and deployment instructions. The public demo creates isolated synthetic sessions.

Video sequence: **0–35 seconds:** conflict, refusal, correction, continuation. **35–55:** clock advance and stale-evidence block. **55–90:** location revocation, purge receipt, re-query, replay rejection, and restart-test evidence.

Cut embeddings, LLM calls, arbitrary documents, entity resolution, external actions, background queues, and content-bearing analytics. Structured fictional inputs make the behavior inspectable.

Render’s free service sleeps and loses local files; free PostgreSQL expires after 30 days. Launch near judging, document the expiry, and renew before it while preserving deletion metadata. Never restore an older content snapshot without current tombstones. Keep zero-cost usage caps and an explicit cold-start state. ([Render constraints](https://render.com/docs/free))

**Two-year thesis — 300 words**

Over the next two years, AI memory will be judged less by how much it stores than by whether people can safely depend on what it retrieves. Remembering creates obligations: explain where a claim came from, identify whom it concerns, recognize when circumstances change, and honor a decision to forget.

Our thesis is that memory should grant conditional permission to act. A remembered preference may justify a suggestion while remaining insufficient to authorize a delivery. This distinction moves uncertainty from conversational style into executable policy. An assistant earns trust when its backend refuses an action that its evidence cannot support.

The first year should establish that contract in narrow domains. We will publish failure fixtures, expose evidence and expiry in a memory inspector, and measure incorrect actions, unnecessary clarification, and deletion failures. Success means fewer unsupported actions without turning every interaction into a confirmation dialog. Evidence grades will remain explicit until independent evaluation justifies stronger statistical claims.

The second year should test portability. Different models and applications should consume the same evidence envelope and obey the same revocation boundary. Independent teams should be able to replay a decision, challenge a source, and verify that a forgotten claim cannot return through an old import or delayed worker.

We expect tension between reproducibility and privacy. Perfect replay often demands retaining exactly what a person wanted removed. Our position is to preserve proof of the deletion operation and its scope while surrendering the deleted content and any promise of reconstructing the old answer.

The durable product is therefore an accountable memory contract, supported by an interface people understand. Its advantage will come from showing when to trust, when to ask, and when to stop. A system that can explain its limits and forget offers a stronger foundation than one that merely remembers more.

*Design only; implementation, deployment, and tests were not performed. Main limits: temporary free hosting and no independently verified physical-storage erasure.*
