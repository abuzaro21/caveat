# Confidence and freshness

CAVEAT never prints a percentage. A number like "87% confident" implies a calibration nobody has done. Instead, every decision reports three things:

- a **grade**, which says what kind of support exists;
- a **freshness** state, which says how old the confirming evidence is compared with what this topic tolerates;
- a **conflict** state, which says what disagrees and whether it matters.

The outcome follows from those three by fixed rules. All of it is in `src/policy.ts`, with tests in `test/policy.test.ts` and `test/review1.test.ts`.

## 1. Grade of one piece of evidence

| Grade | When | Example |
|---|---|---|
| **authoritative** | The source kind is entitled to establish *this predicate* | Maya's own statement of her delivery window; a trusted address-book import of her home city |
| **corroborated** | Reported evidence from **two or more independent, server-attributed sources** agrees. Copies (same lineage) count once. Unsigned imports earn no independence credit. | Two different couriers' logs |
| **reported** | Attributable, but the source is not entitled to establish this predicate | ParcelCo's delivery log about Maya's preference |
| **inferred** | A model's guess from patterns | "Order times suggest evenings" |

A memory's grade is the grade of its strongest support.

## 2. Freshness

Freshness is measured on the support that **establishes** the grade. For a corroborated memory, that is the moment the second independent source reported. A weaker agreeing report, such as an unsigned import dated today, is shown, but it cannot make the memory look fresher.

Freshness is not a decay curve. It compares that age with two per-predicate horizons:

| State | Age of the confirming evidence |
|---|---|
| fresh | ≤ action horizon |
| review-due | > action horizon, ≤ advice horizon |
| stale | > advice horizon |

The horizons differ by topic because topics change at different rates (see [MEMORY-MODEL.md](MEMORY-MODEL.md)):

| Topic | Action horizon |
|---|---|
| Home city | 5 years |
| Delivery window | 6 months |
| Office days | 90 days |
| Private location | 60 days |

The clock is a per-session **virtual clock**. It only moves forward, at most 3 years in total.

## 3. Conflict

All evidence that survives access, consent, revocation, scope and validity is related to the leading value:

| Role | When |
|---|---|
| *corrected* | Older than the person's latest explicit correction. Superseded, whatever its authority. |
| *outdated* | Older than the leader's confirming evidence |
| *weak dissent* | A newer **inference** that disagrees. Shown, never decisive. |
| *dispute* | Newer, attributable disagreement with an **explicit correction**. Recorded; the correction stands. |
| *conflict* | Newer, attributable disagreement with a non-correction memory. The memory becomes **contested**. |

## 4. Outcome

```
strong  = grade ∈ {authoritative, corroborated}
clean   = strong AND not contested AND fresh
outcome = clean ? USE : (purpose = action ? ASK : QUALIFY)
```

- **ABSTAIN** comes earlier in the policy, for revoked topics, missing consent, another person's private memory, or no supporting evidence.
- An action with no usable memory **asks**. Advice with no usable memory **abstains**.
- `mightBeWrong` is true exactly when the outcome is QUALIFY or ASK. Only then does the sentence begin "I might be wrong about this.", followed by the specific reason:
  - the conflicting source, its record count and the date range;
  - "That was 113 days ago, and I re-check this kind of memory after 90 days.";
  - or "The only support is reported: …".

A noted dispute or a newer guess does **not** weaken a strong, fresh memory. The agent does not hedge when the evidence is good.

## 5. The backend gate

`POST /api/book` recomputes the plan inside the booking transaction. It books only if **every** memory the task needs is USE. Otherwise it returns **HTTP 409** with the blocking decision. The browser's view of an earlier plan carries no authority.

The private location is used only for its consented purpose (avoiding slots), and only while it is USE. A forgotten location is never used.
