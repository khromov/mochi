# [BUG] Pending-job TTL (60s) is shorter than a job's worst-case wait at the admission cap, desynchronizing the counter and defeating the 100-job limit

**File:** [`packages/site/src/demos/queue/queue.server.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/queue/queue.server.ts#L15-L59) (lines 15, 18, 19, 20, 31, 32, 33, 59)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`pendingJobs()` (L18-24) evicts any entry older than PENDING_TTL_MS = 60s from the front of `pendingSince`. The comment at L13-14 justifies this with 'Jobs here take under two seconds' — but that is the *processing* time, not a job's residency in the queue, which also includes time spent waiting behind the backlog. With `concurrency: 2` and a job duration uniform in [500, 2000] ms (L46), throughput is about 1.6 jobs/sec, so draining a backlog at the MAX_PENDING_NOTIFICATION_JOBS = 100 cap takes roughly 62s and up to 100s in the worst case. Once the backlog exceeds ~96 jobs, the oldest entries are older than 60s while their jobs are still legitimately queued, so the TTL evicts them. Those jobs then complete and `settle` (L31-35) does an unconditional `pendingSince.shift()`, removing a *newer*, still-valid entry instead. Each wrongly-evicted job thus consumes two entries, so the undercount compounds: `queueStatus().inFlight` drifts toward zero while a large backlog exists, and because the same counter gates admission at L59, the documented 100-job cap admits progressively more than 100 pending jobs, growing the in-memory SQLite job table without a working bound. One source IP cannot trigger this (the route's 60/min limit is 1 job/s, below the 1.6/s drain rate), but a handful of distinct clients sustaining above ~1.6 enqueues/sec reaches the cap in about a minute and then starts the drift. The state does self-heal once the queue fully drains (surplus shifts hit an empty array harmlessly), so the damage is confined to sustained-load windows. Note that the existing test at queue.server.test.ts L22-36 validates only the intended 'lost its terminal event' case and cannot catch this, because it never builds a backlog.

## Recommendation

Stop inferring identity from array position: track pending jobs in a `Map<jobId, enqueuedAt>`, keying on the `jobId` carried by the queue:added/completed/failed payloads, and delete by id on settle so a terminal event can never retire the wrong job. Keep the TTL purely as a safety net and raise it above the worst-case residency at the cap (MAX_PENDING / throughput, i.e. well over 100s here), rather than at the single-job processing time.

## Revalidation

**Verdict:** true-positive

The arithmetic and the mechanism both hold. `pendingJobs()` (L18-24) evicts any front entry older than 60s, and the array is a positional FIFO with no job identity, while `settle` (L31-35) does an unconditional `pendingSince.shift()`. I confirmed the throughput assumption against the backend: `concurrency: 2` maps to bun-boss `localConcurrency: 2` with `batchSize: 1` (queue.ts L1086-1089), and bun-boss's `burstWhileNonEmpty` defaults on (manager.ts, resolveInterval) so a backlog drains at fetch rate with no poll gap — with `Bun.sleep(500 + Math.random()*1500)` that is ~1.6 jobs/s, i.e. ~62s (worst case 100s) to drain the 100-job cap, which exceeds PENDING_TTL_MS. Past a backlog of ~96 the oldest entries age out while their jobs are still legitimately queued; each such eviction decrements the count once, and the job's later completion shifts a newer, still-valid entry, so the undercount compounds. Because `reserveNotificationSlot()` (L59) gates admission on the same counter, MAX_PENDING_NOTIFICATION_JOBS stops being a real bound under sustained overload and the in-memory job table grows. The comment at L13-14 that justifies the TTL ('Jobs here take under two seconds') genuinely conflates processing time with queue residency, which is the root cause. Reachability is as described: one IP is capped at 60 POST/min (1/s, below the 1.6/s drain), so it needs a couple of distinct clients, and the state self-heals on full drain since `shift()` on an empty array is a no-op. I also confirmed the existing test (queue.server.test.ts L22-36) only emits a single `queue:added` and fast-forwards `Date.now`, so it cannot catch this. The recommended `Map<jobId, enqueuedAt>` is the right fix — the payloads already carry `jobId` (events.ts MochiQueueAddedEvent/CompletedEvent/FailedEvent).

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
