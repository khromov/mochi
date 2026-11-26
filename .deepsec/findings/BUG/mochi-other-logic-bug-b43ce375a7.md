# [BUG] `Mochi.worker().stop()` never clears `started`, so a stopped worker cannot be restarted

**File:** [`packages/mochi/src/queue.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/queue.ts#L1137-L1189) (lines 1137, 1181, 1189)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`createWorker` tracks `let started = false` (L1137). `start()` sets `started = true` and correctly rolls it back on failure (L1176-1179), but `stop()` (L1181-1193) only deregisters the workers via `offWork` and deletes their `workIds` — it never resets `started`. A subsequent `start()` therefore throws `Mochi.worker(): this worker was already started.` (L1140-1142) even though no worker is registered any more, leaving the handle permanently inert: the queues exist, the runtime is still up for producers, but this process can never resume consuming without constructing a new worker. A long-lived serverless/standalone consumer that pauses and resumes around maintenance (the exact lifecycle the `start`/`stop` pair exists for) wedges silently.

## Recommendation

Set `started = false` at the end of `stop()` (after the `offWork` loop), so the handle returns to a restartable state; alternatively document explicitly that a worker handle is single-use and throw a clearer error from `start()` after `stop()`.

## Revalidation

**Verdict:** true-positive

Confirmed by reading `createWorker` in full (queue.ts:1105-1195). `started` is declared at 1137; `start()` throws 'Mochi.worker(): this worker was already started.' when it is set (1140-1142), sets it at 1149, and correctly rolls it back in the catch at 1177 — so the variable is clearly intended to mean 'currently started'. `stop()` (1181-1193) only loops over the queues calling `boss.offWork(...)` and deleting their `workIds`; it never resets `started`. The handle is therefore permanently inert after a stop: no worker is registered, yet `start()` rejects with a message that is actively misleading in that state. docs/115-queues.md:146 documents `worker.stop()` as deregistering the queues 'while the runtime stays up for producing' and never says the handle is single-use, so a pause/resume lifecycle is a reasonable reading; the only overstatement in the finding is 'wedges silently' — it throws rather than failing quietly. BUG is the right severity: a real state-machine asymmetry with a one-line fix (reset `started` at the end of `stop()`), affecting only an uncommon pause/resume pattern.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-26)
