Reviewed all `src/*.ts`, `test/*.ts`, and both architecture documents at HEAD `0c5e46899894b815941cd7bfddd8de2dfe3544e7`. The 48 existing tests excluding the disk/restart test passed on in-memory SQLite. Additional inline probes reproduced findings 1–8; finding 9 follows from the PostgreSQL transaction paths.

1. **HIGH — An unauthenticated malformed URL can terminate the server.** [src/server.ts:130](E:/doo/caveat/src/server.ts:130)  
   **Reproduction:** Send `GET http://[ HTTP/1.1` with a valid `Host` header. `new URL()` throws before entering `try`. I reproduced an unhandled rejection; Node’s default handling terminates the process.  
   **Violated guarantee:** Malformed HTTP input must remain a request failure, not become service-wide denial of service.  
   **Minimal fix:** Parse the URL inside the error boundary and return 400 for malformed targets.

2. **HIGH — Caller-chosen lineage manufactures corroboration and permits booking.** [src/memory.ts:196](E:/doo/caveat/src/memory.ts:196), [src/policy.ts:135](E:/doo/caveat/src/policy.ts:135)  
   **Reproduction:** Forget `delivery.window` using `before`, then advance one day. Import two unsigned items with subject `maya`, predicate `delivery.window`, scope `{place:'home'}`, value `evening`, and `observedAt` equal to the current clock. Give them distinct `originId` and `lineage` strings. The result is `corroborated`, `USE`, and a successful sofa booking. Both “independent sources” came from one caller.  
   **Violated guarantee:** Unverified copies cannot establish independent corroboration.  
   **Minimal fix:** Award independence only through authenticated, server-assigned source identities; caller-declared lineage cannot supply corroboration credit.

3. **HIGH — One unsigned matching report refreshes authority and erases disagreement.** [src/policy.ts:130](E:/doo/caveat/src/policy.ts:130), [src/policy.ts:166](E:/doo/caveat/src/policy.ts:166), [src/policy.ts:186](E:/doo/caveat/src/policy.ts:186)  
   **Reproduction:** In a fresh session, import one unsigned report supporting Maya’s home `morning` preference with `observedAt=current clock`. The seeded contested decision changes from `ASK` to authoritative `USE`: courier objections become “outdated,” and the warranted caveat disappears. Separately, correct the preference to `afternoon`, advance 181 days, then import unsigned matching support dated now. The stale correction becomes authoritative, fresh, age zero.  
   **Violated guarantee:** Low-authority agreement cannot renew an authoritative correction or independently resolve contrary evidence.  
   **Minimal fix:** Compute freshness and supersession from support sufficient to establish the effective grade, rather than the newest matching item of any authority.

4. **HIGH — Forgetting leaves private booking text while reporting successful verification.** [src/memory.ts:372](E:/doo/caveat/src/memory.ts:372), [src/memory.ts:552](E:/doo/caveat/src/memory.ts:552)  
   **Reproduction:** Correct home deliveries to `afternoon`; tell a private location `{label:'Gym',day:'fri',from:15,to:17}` with excerpt `Gym`; book the sofa; forget `location.private` with `block`. The receipt says `verified:true`, but `/api/state` still returns a booking reason containing `Gym` and its Friday hours. The scan excludes three-character markers, and dependency removal does not itself redact the reason. `window_label` also retains a forgotten delivery preference in a separate reproduction.  
   **Violated guarantee:** Controlled booking copies must be purged, and verification must cover them.  
   **Minimal fix:** Redact dependent booking content using evidence dependencies, including relevant preference fields; do not use distinctive-word matching as the deletion mechanism.

5. **HIGH — The controlled worker inbox retains forgotten plaintext.** [src/memory.ts:343](E:/doo/caveat/src/memory.ts:343), [src/memory.ts:492](E:/doo/caveat/src/memory.ts:492)  
   **Reproduction:** Queue a digest, then forget `location.private`. The receipt returns `verified:true`, while `c.worker.get(sid).captured` still contains `Harbour Physio`. It remains until release, replacement, session deletion, or process exit. Release correctly fences the write, but fencing does not delete the captured copy.  
   **Violated guarantee:** Forgetting removes content everywhere this process controls, including queued work.  
   **Minimal fix:** Queue identifiers and revision only, then rehydrate under the session lock. Include worker storage in deletion verification.

6. **HIGH — `before` mode allows retimestamped resurrection and rejects immediate legitimate relearning.** [src/memory.ts:180](E:/doo/caveat/src/memory.ts:180), [src/memory.ts:187](E:/doo/caveat/src/memory.ts:187)  
   **Reproduction:** Export a private-location item; forget using `before`; advance one day; import the copied item with a new `originId` and `observedAt=current clock`. It is accepted as unsigned evidence, and inspection exposes the forgotten content again. Conversely, immediately telling a genuinely new private location after forgetting fails because direct statements receive the unchanged virtual clock, equal to `revokedAt`.  
   **Violated guarantee:** Old copies stay blocked while new owner statements may be learned.  
   **Minimal fix:** Distinguish newly authenticated statements from imported timestamps. Permit post-revocation owner statements by serialized operation order; require explicit authorization before imports can repopulate that topic.

7. **MEDIUM — Static-file containment accepts sibling paths sharing the directory prefix.** [src/server.ts:118](E:/doo/caveat/src/server.ts:118)  
   **Reproduction:** With public root `.../public`, request `/%2e%2e%2fpublic-backup/secret.json`. The normalized sibling path still passes `startsWith(publicDir)`. I reproduced the escape without writing files: `publicDir='test/h'` allowed that traversal pattern to serve `test/helpers.ts`. Exposure depends on available sibling files.  
   **Violated guarantee:** Static responses stay within the configured public directory.  
   **Minimal fix:** Use a path-component containment check, such as validated `relative()` output, rather than a string prefix.

8. **MEDIUM — Future delivery holds do not constrain the delivery date.** [src/tasks.ts:35](E:/doo/caveat/src/tasks.ts:35), [src/tasks.ts:54](E:/doo/caveat/src/tasks.ts:54)  
   **Reproduction:** Correct home deliveries to `afternoon`. Through `ingest(...,'chat',...)`, establish a hold valid from `clock+DAY` through `clock+10*DAY`. Planning reports no active hold and permits Monday 16 November, inside that interval. The hold is evaluated only at booking time.  
   **Violated guarantee:** A scheduled delivery must respect constraints applicable when the delivery occurs.  
   **Minimal fix:** Evaluate holds against each candidate slot and reject slots intersecting an applicable hold.

9. **MEDIUM — PostgreSQL exports can sign a revision inconsistent with their evidence.** [src/memory.ts:464](E:/doo/caveat/src/memory.ts:464), [src/db.ts:116](E:/doo/caveat/src/db.ts:116)  
   **Reproduction schedule:** Under PostgreSQL’s default READ COMMITTED isolation, pause export after its session/revision SELECT. Commit a correction on another connection, then resume export’s evidence SELECT. The signed envelope contains revision R with evidence from R+1. `tx(null)` acquires no session lock; SQLite’s global transaction chain masks this behavior.  
   **Violated guarantee:** Retrieval and mutation serialize through the session row, producing one consistent revision.  
   **Minimal fix:** Run export through `tx(sid, ...)` or reuse the locked snapshot path.

**Verdict: DO NOT SHIP.** Top five fixes, in priority order:

1. Contain malformed-URL exceptions.
2. Prevent caller-declared source independence.
3. Bind freshness and conflict resolution to qualifying authority.
4. Purge booking content by dependency.
5. Remove plaintext from queued jobs and verify their deletion.

Not run: PostgreSQL execution, disk/restart/WAL tests, or production checks. I made no file changes; authority inflation and incomplete forgetting remain demonstrated risks.


