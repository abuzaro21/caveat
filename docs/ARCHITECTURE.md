# Architecture

CAVEAT is one Node 24 process. It serves a React UI and a JSON API, and stores everything in PostgreSQL or SQLite. Both stores use the same DDL, and every test runs against both. Nothing calls a language model. The decision policy is a pure function, so every verdict can be reproduced from the stored evidence.

```
browser (React, no authority) ──HTTP/JSON──▶ server.ts ──▶ memory.ts (Caveat) ──▶ db.ts ──▶ PostgreSQL | SQLite
                                               │              │
                                               │              ├─ policy.ts   evaluate(evidence, tombstones, query) → Decision
                                               │              ├─ tasks.ts    plan(...) → slot or block
                                               │              └─ naive.ts    the negative control
                                               └─ session cookie (HttpOnly, SameSite=Strict); sha256(token) is the session id
```

| File | Responsibility |
|---|---|
| `src/model.ts` | Types, the predicate registry (authority, horizons, retention, consent, scope) and value validation |
| `src/policy.ts` | `evaluate()`: access, consent, revocation, scope, validity, corrections, grading, conflict, freshness and the outcome |
| `src/memory.ts` | The `Caveat` class: sessions, the write path, retrieval, tasks, forgetting, retention, import/export and the delayed worker |
| `src/tasks.ts` | The two consequential tasks and the slot planner (private-time avoidance, holds) |
| `src/db.ts` | `Db` interface with `tx(lock, fn)`. SQLite uses `BEGIN IMMEDIATE` behind a promise mutex; PostgreSQL uses `SELECT … FOR UPDATE` on the session row |
| `src/server.ts` | HTTP: sessions, rate limits, CSP and headers, the JSON-only API, static files |
| `ui/src/*` | Assistant, evidence panel, memory inspector, forgetting center |

## Invariants

1. Every row carries its session id, and every mutation locks the session row first. Reads that feed decisions use the same lock, so one decision sees one revision.
2. The server assigns the source kind from the ingestion channel, never from the payload. An unsigned import is a third-party report, whatever it claims to be.
3. The search index never authorises an answer. It only nominates memory slots, and the policy decides from evidence.
4. The backend gate (`book`) recomputes the plan inside its own transaction. A plan the browser saw earlier carries no authority.
5. Forgetting is reported complete only after its transaction commits and the post-commit checks run.
6. Tombstones carry no content: no value and no fingerprint of a value.

## Write path

```mermaid
flowchart LR
  A[chat statement / correction / import / seed] --> B{validate<br/>subject, predicate, value, scope, dates}
  B -- invalid --> R1[rejected with reason]
  B --> C{tombstone?}
  C -- block --> R2[rejected: topic revoked]
  C -- before + unsigned import --> R3[rejected: imports cannot restore]
  C -- before + signed, observed ≤ revocation --> R4[rejected: observed before the forget]
  C -- none / allowed --> D{retention period passed?}
  D -- yes --> R5[rejected: past retention]
  D -- no --> E{origin id already stored?}
  E -- yes --> R6[duplicate]
  E -- no --> F[insert evidence + index terms<br/>bump revision, rebuild summaries, audit]
```

The **source kind** comes from the channel:
- `chat` gives `user_statement`.
- `correction` gives `user_correction`.
- An **unsigned** import is always `third_party`, with the fixed lineage `unsigned-import` and the label prefix "Unsigned import · ".
- A **signed** import keeps the kind, lineage and dates it was exported with. The signature is an HMAC over the body, which binds it to its session.

Observation time is "now" for anything said now. An import keeps its original time and can never look fresher than it is.

## Retrieval path

```mermaid
flowchart LR
  Q[question or task] --> S[lock session · snapshot evidence, tombstones, revision]
  S --> F1[consent + revocation filter<br/>before search]
  F1 --> I[index lookup inside the snapshot<br/>nominates memory slots]
  I --> P[policy.evaluate per slot]
  P --> O{outcome}
  O -- USE --> U[answer / act]
  O -- QUALIFY --> Qy[answer with 'I might be wrong about this.' · no action]
  O -- ASK --> K[ask a targeted question · no action]
  O -- ABSTAIN --> N[say nothing from memory]
```

`ask()` returns a trace with real server timings per step. A decision cache, keyed by session and revision, sits in front of `decide()`. A forget purges it and raises a per-session floor, so a read that raced the forget can never be cached below the floor.

## Forget path

```mermaid
flowchart TD
  F[forget topic, mode] --> T[one transaction, session locked]
  T --> D1[delete evidence rows]
  T --> D2[delete their index entries and usage records]
  T --> D3[rewrite booking text derived from them, by recorded dependency]
  T --> D4[rebuild derived summaries]
  T --> D5[write content-free tombstone · bump revision · audit counts]
  D5 --> C[commit]
  C --> P1[purge decision cache · raise cache floor · strip ids from queued jobs]
  P1 --> P2[storage compaction: SQLite secure_delete + WAL checkpoint TRUNCATE]
  P2 --> V[14 post-commit checks against tables, export, cache, worker inbox, retrieval]
  V --> RC[content-free receipt: deleted, rewritten, kept, checks, limits]
```

The delayed worker (`queueDigest` and `releaseDigest`) stands in for work done in another process. A job holds only evidence ids and the revision it was planned against. When it runs it rebuilds its data from current storage under the session lock, and it is fenced: if the revision has moved, it is discarded without writing.

## Deployment

The service runs in a Docker image on Render's free web tier, backed by free Render PostgreSQL 16 (`render.yaml`). It does not use persistent disks. The SQLite mode is for local runs and tests. See [DEPLOY.md](DEPLOY.md).
