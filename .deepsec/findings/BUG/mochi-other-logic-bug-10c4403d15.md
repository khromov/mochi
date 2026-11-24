# [BUG] Support email processor is not idempotent — no claim() guard, unlike the newsletter twin

**File:** [`packages/support/src/jobs.server.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/jobs.server.ts#L22-L32) (lines 22, 23, 32)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The processor goes straight from `getSubmission` (L23) to `Mochi.email` (L32) with no state claim. `createDeliveryLog` exposes exactly the primitive for this — `claim()`, an atomic `UPDATE … SET email_status = 'sending' WHERE id = ? AND email_status = 'pending'` (db.server.ts:157-159) — and the newsletter processor uses it (newsletter/jobs.server.ts:41) with the rationale "the queue delivering the same job twice would otherwise mail two confirmations". The submission path never calls it; `claimNewsletterSend` is the only exported wrapper and there is no `claimSubmissionSend`.

Durable queues are at-least-once, so a crash or container restart after the SMTP handoff but before the job is acked redelivers the job, and this processor re-sends the whole support email and appends a second `sent` line to the delivery log. The two delivery paths were explicitly refactored onto one `createDeliveryLog` implementation "so the submission and newsletter delivery paths can't drift apart the way subReArmStmt and refreshConfirmToken already had" (db.server.ts:128-129) — this is that same drift, still present.

Impact is lower than the newsletter case (the duplicate goes to the team's own inbox, not a subscriber's), which is presumably why it was never added, but it is an unguarded re-send on a path whose sibling is guarded.

## Recommendation

Export a `claimSubmissionSend(id)` wrapper over `submissionDelivery.claim` in db.server.ts and gate the processor on it the way newsletter/jobs.server.ts:41 does — returning `{ sent: false }` with a 'skipped' log line when the claim fails.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. The support processor goes from getSubmission (L23) straight to Mochi.email (L32) with no state claim and not even an email_status check — a grep for claim|email_status|idempot|dedup across jobs.server.ts and routes.ts returns nothing, and Mochi.email itself has no dedup. The primitive the finding points at is real and exactly as described: createDeliveryLog exposes claim() as an atomic UPDATE … SET email_status='sending' WHERE id=? AND email_status='pending' (db.server.ts:136, 157-159), claimNewsletterSend is the only exported wrapper, and no claimSubmissionSend exists. The decisive question was whether redelivery actually occurs, and it does, three ways: bun-boss's selectJobsToFailByTimeout (plans.ts:2028-2036) fails any active job past started_on + expire_seconds with expire_seconds defaulting to FIFTEEN_MINUTES and retry_limit 2, moving it to retry state (plans.ts:1794), and the support queue overrides neither; queue.ts:1249-1252 documents the shutdown case verbatim ('a job still running when the window lapses is failed and follows its retry policy… lets it finish instead of being re-run'), and support/index.ts never sets queueShutdownTimeout, so the drain budget is the 10s default — shorter than a slow SMTP handoff during a routine deploy; and storage is durable sqlite (.db/queue.sqlite), so jobs survive a restart rather than evaporating. Concrete scenario: a deploy sends SIGTERM while an SMTP handoff is in flight; the 10s window lapses, bun-boss fails and retries the job, the retry finds the row (already email_status 'sent') and unconditionally re-mails the whole support email, appending a second 'sent' row since appendLog is a plain INSERT. I also confirmed why only unclean death matters — noteAttemptError resets status to 'pending', which db.server.ts:147-148 notes releases the claim so a retry can re-acquire it, so a clean SMTP throw is handled correctly on both paths; only a kill/crash/expiry leaves the row stuck, which is exactly the window the newsletter's claim covers and support's lacks. I weighed the best counterargument — that the inverse trade-off is defensible here (a duplicate to your own inbox beats a dropped customer request, echoing routes.ts:63's store-first-never-lose-it priority) — but rejected it: nothing documents that choice in a codebase that comments trade-offs heavily and documents the claim's presence on the sibling path; the newsletter has a dedicated regression test (newsletter.test.ts:321-336) while support.test.ts has no duplicate coverage at all; and a claim would not actually drop the message, since the row stays visible in /admin/ with its status, the same fallback that route comment already depends on. BUG is the right severity and I left it unchanged: this is not a security issue and not attacker-triggerable (an attacker cannot force a crash mid-send), the trigger window is narrow, and the blast radius is a duplicate to the team's own SUPPORT_TO inbox plus a cosmetically wrong admin delivery log — real, but low-impact.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-09)
