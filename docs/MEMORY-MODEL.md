# Memory model

CAVEAT stores **evidence**, not facts. A "memory" is what the policy concludes from all the evidence about one *subject* and *predicate* in one *scope*, at one virtual instant. That conclusion is recomputed every time, so it changes when time passes, when new evidence arrives, and when evidence is deleted.

## Evidence record (`evidence` table)

| Field | Meaning |
|---|---|
| `subject` | Who the evidence is about: `maya` or `sam` (fictional household) |
| `predicate` | The topic, from a fixed registry (below) |
| `scope_key` | Where it applies: `place=home`, `place=office`, or empty for everywhere |
| `value`, `stance` | The claimed value and whether the evidence `supports` it or `opposes` it (for example, a failed morning delivery opposes "mornings") |
| `source_kind` | `user_statement`, `user_correction`, `trusted_import`, `observed_event`, `third_party` or `model_inference`. The server assigns it from the channel. |
| `source_label`, `lineage` | Human-readable source, and the source identity used to decide independence (copies share a lineage) |
| `origin_id` | Deduplication key, unique per session |
| `excerpt` | The words the evidence was recorded from, at most 280 characters |
| `observed_at`, `ingested_at` | When it was true and when it entered CAVEAT. An import keeps the original `observed_at`. |
| `valid_from`, `valid_until` | Optional validity interval (a delivery hold, say) |
| `corrects` | An explicit correction supersedes everything older in its scope |
| `seq` | Ingestion order within the session: the deterministic tie-break |

## Predicate registry (`src/model.ts`)

| Predicate | Authoritative sources | Act if confirmed within | Advise (with caveat) within | Retention | Sensitive | Shared with household | Scoped |
|---|---|---|---|---|---|---|---|
| Delivery window | the person (statement or correction) | 180 days | 365 days | courier logs and third-party reports: 60 days | no | yes | home / office |
| Office days | the person | 90 days | 180 days | — | no | no | no |
| Home city | the person, a trusted import | 1825 days | 3650 days | — | no | yes | no |
| Private recurring location | the person | 60 days | 90 days | — | **yes**: consented only for delivery planning | no | no |
| Delivery hold | the person | 30 days | 30 days | — | no | yes | no (has a validity interval) |

## What is not a contradiction

- **Another place.** "Mornings at the office" does not contradict "mornings at home". It is listed as *different scope*.
- **Another person.** Sam's "evenings" does not contradict Maya's "mornings". It is listed as *a different person's fact, not a contradiction*.
- **Another time.** An August hold that expired is listed as *another time*, and is not used now.
- **Less specific evidence.** A general memory gives way to a place-specific one when one exists.

## Other stores

| Table | Holds | Content? |
|---|---|---|
| `memory_index` | search terms per evidence row | derived from content; deleted with it |
| `summaries` | a derived profile line per person, with its evidence dependencies | derived; rebuilt after every change |
| `uses` | which evidence a task relied on | ids only |
| `bookings` | simulated deliveries: slot, place, window label, reason parts, each with evidence dependencies | derived text, rewritten by dependency on forget |
| `tombstones` | person, topic, mode, revocation time, revision | **no content** |
| `receipts` | deletion and retention receipts | **no content**: counts, checks, limits |
| `audit` | operation names, ids and counts | **no content** |
| `sessions` | sha256(cookie token), virtual clock, revision, sequence counters | — |

## Lifecycle

```
stated ──▶ active ──(newer attributable disagreement)──▶ contested ──(person answers)──▶ corrected ──▶ active
   │          │
   │          └──(age > action horizon)──▶ needs review ──(reconfirmed)──▶ active
   │                                          └──(age > advice horizon)──▶ stale: abstain from advice
   ├──(validity interval ends)──▶ expired (kept, not used)
   ├──(retention period passes)──▶ deleted by scheduled retention, with a receipt
   └──(person forgets it)──▶ deleted, tombstoned, verified, with a receipt
```
