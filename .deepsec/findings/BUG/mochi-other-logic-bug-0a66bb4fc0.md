# [BUG] settle assumes one terminal event per enqueue, but queue:failed is emitted once per retry attempt

**File:** [`packages/site/src/demos/queue/queue.server.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/queue/queue.server.ts#L26-L41) (lines 26, 31, 32, 33, 34, 41)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`settle` (L31-35) is subscribed to both `queue:completed` and `queue:failed` and shifts one entry per event, pairing with the single `pendingSince.push()` that `queue:added` performs (L26-30). That one-in/one-out assumption does not hold. The framework emits `queue:failed` from `makeHandler` on *every* failed attempt (packages/mochi/src/queue.ts L576, which even carries an `attempt` field), including non-final attempts that will be retried, while `queue:added` is emitted only from the producer methods (`add`/`addBulk`/`addThrottled`/`addDebounced`, L596-635) and never on a retry. This queue declares no `retryLimit`, so it inherits bun-boss's default of 2 (node_modules/bun-boss/src/plans.ts L61, with the retry decision at manager.ts L1513). A job that fails every attempt therefore produces one push and three shifts, silently retiring two other in-flight jobs' entries and permanently undercounting `inFlight` for the remainder of the load window — the same failure mode as the TTL issue above, from an independent cause. It also means the counter drops on a non-terminal failure while the job is still genuinely pending. Reachability is low in this particular demo because the processor (L43-53) does nothing that can throw, so I rate this a latent correctness defect rather than a live one — but queue.server.ts is published verbatim as demo/template source via files.ts, so the pattern gets copied into processors that do throw.

## Recommendation

Make settlement idempotent per job rather than per event: with the `Map<jobId, …>` suggested above, `delete(jobId)` is naturally safe against duplicate failure events. Alternatively, ignore non-terminal failures by comparing the payload's `attempt` against the queue's configured `retryLimit`, and declare `retryLimit` explicitly on the descriptor (e.g. `retryLimit: 0`) so the demo's event accounting does not silently depend on a transitive default.

## Revalidation

**Verdict:** true-positive

The framework-level claim is exactly right. `makeHandler` emits `queue:failed` from its catch on every attempt, carrying `attempt: raw.retryCount + 1` (queue.ts L576), whereas `queue:added` is emitted only from the producer methods (L598, L617), never on a retry. bun-boss's `failJobsBody` retries while `retry_count < retry_limit` (manager.ts ~L1513 / plans.ts failJobsBody), and the stored default is `retry_limit: 2` (plans.ts QUEUE_DEFAULTS L61) — Mochi mirrors that default and this descriptor declares no `retryLimit`, so a job failing every attempt produces one `queue:added` and three `queue:failed`, i.e. one push and three shifts, retiring two other in-flight jobs' entries. So the one-in/one-out assumption encoded in `settle` (subscribed to both `queue:completed` and `queue:failed`, L36-37) is unsound, and it also decrements on a non-terminal failure while the job is still pending. I agree with the reporter's own scoping that this is latent rather than live: the processor (L43-53) does `Bun.sleep`, an array push/shift and an increment, with `job.data.user` always populated by `enqueueNotification`, so there is no throw path, and expiry-based failures are raised by bun-boss's supervisor rather than by `makeHandler`, so they emit no Mochi event. That matters for prioritisation, but the defect is real in code that files.ts publishes verbatim as demo/template source, where it will be copied into processors that do throw. Distinct from F4: different trigger (event multiplicity vs TTL-vs-residency) and separately fixable, even though the suggested jobId-keyed Map happens to cure both.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
