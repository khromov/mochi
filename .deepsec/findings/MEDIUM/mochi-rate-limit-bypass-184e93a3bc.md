# [MEDIUM] Public support-form submission has no rate limit — unbounded mail send and DB growth

**File:** [`packages/support/src/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/routes.ts#L35-L74) (lines 35, 38, 66, 74)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`/` is the only state-mutating, mail-sending, unauthenticated route in this app with no `rateLimit`, and `Mochi.serve()` in index.ts sets no global `rateLimit` either. Every sibling public route in the same codebase has one: `/admin` (L85), `/newsletter/embed` (newsletter/routes.ts:15), `/newsletter/confirm` and `/newsletter/unsubscribe` (L85, L107). A successful POST to `?/send` inserts a row into `.db/support.sqlite` (L66) and enqueues an SMTP delivery to SUPPORT_TO (L74), so the only throttle is the PoW captcha.

The captcha does not bound throughput:
1. The GET that mints tokens (`serverProps: () => ({ captcha: mintCaptcha() })`, L36) is itself unlimited, so an attacker harvests tokens in bulk.
2. `captcha.bits` defaults to 19 (~2^19 SHA-256), which is ~1s of *browser JS* but a few milliseconds of native code, and is embarrassingly parallel.
3. `minAgeMs: 2000` only requires the token be 2s old at verify time — it is amortized away by pipelining (mint N tokens, solve them, submit them all after one 2s wait).

Net effect: a single host can sustain hundreds of submissions/second, flooding support@mochi.fast, growing the SQLite file without bound, and burning the SMTP relay's reputation/quota (the relay suspension then takes the newsletter double-opt-in down with it, since both queues share the same transport).

## Recommendation

Add a `rateLimit` to the `/` page mirroring the newsletter embed's, e.g. `rateLimit: { limit: 5, window: '15m', ban: { threshold: 3, duration: '1h' }, skip: (req) => req.method !== 'POST' }` — skipping GETs so an ordinary reader reloading the page never spends quota, exactly as newsletter/routes.ts:19 does.

## Revalidation

**Verdict:** true-positive

Verified: `'/'` in packages/support/src/routes.ts:35 declares `serverProps` and the `send` action with no `rateLimit`, and `Mochi.serve()` in index.ts sets no global `rateLimit` and no `protection` gate, so `buildLimiter` (Mochi.ts:801-829) returns `null` for this pattern and `checkRouteLimit` is a no-op — there is genuinely no throttle on the route. Every sibling public route does have one (`/admin` routes.ts:85, `/newsletter/embed` newsletter/routes.ts:15, and both token GETs at 85/107), which makes the omission look like an oversight rather than a decision. A successful POST writes a row via `insertSubmission` (routes.ts:66) and enqueues an SMTP delivery to SUPPORT_TO (routes.ts:74), both unauthenticated. The captcha genuinely does not bound throughput: the token-minting GET is itself unlimited (`serverProps: () => ({ captcha: mintCaptcha() })`), the nonce store only stops reuse of one token rather than bulk minting, and `minAgeMs: 2000` is a per-token age check at verify time, which pipelining amortizes to nothing. I'd soften one number — at `DEFAULT_CAPTCHA_BITS = 19` the expected ~524k SHA-256 attempts is tens of milliseconds of native work per token, not 'a few milliseconds' (pow.ts documents ~1.36µs/attempt for the JS implementation), so a single host is plausibly in the tens-to-low-hundreds of submissions per second rather than 'hundreds', and it parallelizes trivially across cores or hosts. That does not change the conclusion: unbounded row insertion in `.db/support.sqlite`, unbounded jobs in the shared `queue.sqlite`, and unbounded mail to the one SMTP relay that the newsletter double-opt-in also depends on. MEDIUM is appropriate, and the suggested `skip: (req) => req.method !== 'POST'` mirrors the embed's existing shape exactly.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-15)
