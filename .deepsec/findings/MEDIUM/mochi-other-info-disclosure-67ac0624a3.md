# [MEDIUM] Timing side channel reintroduces the subscriber oracle the response shapes were built to close

**File:** [`packages/support/src/newsletter/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/newsletter/routes.ts#L66-L76) (lines 66, 67, 69, 76)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

db.server.ts L257-259 states the invariant: "Apart from `throttled`, callers must render every outcome identically, or the public widget becomes a subscriber oracle." The HTTP responses do honour it — an `already` (address is a confirmed subscriber) and a `created` (address is unknown) both return a bare `success()` at L76 with byte-identical bodies. But the work done before that return is not identical: L66 gates both `appendNewsletterLog()` (a WAL commit on support.sqlite) and `await newsletterEmailQueue.add()` (a WAL commit on the separate queue.sqlite, awaited, plus bun-boss's enqueue/notify path) on `outcome.kind !== 'already'`. A probe for a confirmed address skips both and answers measurably sooner than a probe for an unknown address. That is the exact distinction the identical response shapes exist to hide, so an attacker recovers subscriber membership for a chosen address by comparing its response latency against a known-unknown control address. Rate limiting bounds but does not close this: the attacker gets a clean sample per address roughly every RESEND_COOLDOWN_MS (5 min, after which `already` is idempotent and resets only `requested_at`), within 20 POSTs/10 min/IP, at the cost of one PoW solve per probe — so tens of samples per address per day, from any number of IPs. Probing a confirmed address is also side-effect-free, leaving nothing in the admin panel to notice.

## Recommendation

Make the two branches cost the same. Simplest: drop the `outcome.kind !== 'already'` gate and always write the log line and enqueue, letting the processor's existing `subscriber.status !== 'pending'` guard (jobs.server.ts L35) no-op the `already` case — it is already written to handle exactly that and logs a 'Skipped' line. If the wasted enqueue is unwanted, instead normalise the response time (await a fixed floor, e.g. `Bun.sleep` to a constant deadline measured from the start of the action) before returning, so neither branch is distinguishable.

## Revalidation

**Verdict:** true-positive

The asymmetry is real and sits directly against the invariant the code documents for itself at db.server.ts L257-259. The HTTP responses are indistinguishable — `already` and `created` both fall through to the bare `success()` at L76 — but L66 gates `appendNewsletterLog()` and the awaited `newsletterEmailQueue.add()` on `outcome.kind !== 'already'`, so an address that is a confirmed subscriber short-circuits both. The delta is larger than it first looks: the log insert commits on support.sqlite, and the queue insert commits on a separate SQLite file that Mochi opens with no WAL/synchronous pragma (queue.ts L494, and bun-boss's adapter sets only `foreign_keys` and `busy_timeout`), so the non-`already` path pays extra fsyncing commits plus serialization behind the worker's in-flight queries — a millisecond-scale mean shift, not microseconds. The sampling model also holds up: `requestSubscription` checks the cooldown ahead of the confirmed branch (so the response shape stays uniform), which leaves one clean sample per address per RESEND_COOLDOWN_MS, about 12/hour, comfortably inside the 20-POST/10-min limit and its 3-strike ban, at 19 bits of PoW per probe (DEFAULT_CAPTCHA_BITS) — and an attacker-owned control address exercises the non-`already` path on every probe, cancelling network drift. Probing a confirmed address is side-effect-free as claimed. Honest caveats: the signal must be recovered from internet jitter, so hundreds of interleaved samples per address are needed, and every probe of a non-subscriber mails that address a confirmation, so the campaign is noisy. It stays a true positive because nothing in the code closes the channel, and the suggested fix (always log and enqueue, letting jobs.server.ts L35's `status !== 'pending'` guard no-op the `already` case, or normalise to a fixed response floor) is cheap.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-15)
