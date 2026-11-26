# [BUG] Numeric newsletter env config is unvalidated: an explicit 0 is silently ignored and a negative value breaks signup entirely

**File:** [`packages/support/src/newsletter/config.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/newsletter/config.ts#L3-L5) (lines 3, 5)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Both knobs use the `Number(x) || default` idiom. `Number('0')` is 0, which is falsy, so `NEWSLETTER_RESEND_COOLDOWN_MS=0` and `NEWSLETTER_CONFIRM_TTL_DAYS=0` are silently discarded and the operator gets the 5-minute / 14-day defaults instead of the opt-out they asked for — a real footgun for a test or staging environment trying to disable the resend cooldown, which will then appear to be ignored with no warning. Worse in the other direction, a negative value is truthy and passes straight through: `NEWSLETTER_CONFIRM_TTL_DAYS=-1` yields a negative CONFIRM_TTL_MS, so `requestSubscription` writes `confirm_expires_at = now + negative` (db.server.ts L267) — every confirmation link is born already expired (routes.ts L98 returns 'expired' on the first click) and `purgeExpiredPendingSubscribers` deletes every new signup on its next nightly run. Signup breaks completely and silently, with no boot-time error. The codebase already recognises this class and handles it correctly two files away — `adminAuth.ts` L31 explicitly comments "An empty or malformed var must not silently disable the tarpit (`Number('')` is 0, `Number('abc')` is NaN) — an explicit `0` still opts out" and uses a `Number.isFinite(x) && x >= 0` guard. config.ts just doesn't follow the house pattern.

## Recommendation

Adopt the adminAuth.ts pattern: parse the raw string, then accept it only when `Number.isFinite(parsed) && parsed >= 0`, falling back to the default otherwise — so an explicit `0` opts out and a negative or junk value falls back loudly. Better still, validate in the existing `mochi:init` hook in index.ts and throw on a negative TTL, matching how ADMIN_PASSWORD/SMTP_HOST/MOCHI_ORIGIN are already enforced at boot.

## Revalidation

**Verdict:** true-positive

Both halves are straightforwardly correct. `Number('0')` is 0 and therefore falsy, so `NEWSLETTER_RESEND_COOLDOWN_MS=0` and `NEWSLETTER_CONFIRM_TTL_DAYS=0` are discarded in favour of the 5-minute / 14-day defaults — an operator who tries to disable the resend cooldown in staging gets silently ignored, and both knobs are documented, operator-facing variables in packages/support/.env.example (lines 64 and 66), so this is a supported configuration surface rather than a hypothetical. A negative value is truthy and passes through: with `NEWSLETTER_CONFIRM_TTL_DAYS=-1`, `requestSubscription` stores `confirm_expires_at = now + negative` (db.server.ts L267), the confirm route's `confirm_expires_at <= Date.now()` check (routes.ts L98) returns 'expired' on the recipient's first click, and `purgeExpiredPendingSubscribers` — which selects `status='pending' AND confirm_expires_at < ?` (db.server.ts L241) — deletes every new signup on the next nightly cron run. Signup breaks completely and silently, and index.ts's `mochi:init` hook validates only ADMIN_PASSWORD, SMTP_HOST and MOCHI_ORIGIN, so there is no boot-time guard. The house-pattern argument also checks out verbatim: adminAuth.ts L31-34 carries exactly the quoted comment and uses `Number.isFinite(configured) && configured >= 0`. This is operator-triggered rather than attacker-triggered, which is what BUG severity already reflects; the recommended `Number.isFinite && >= 0` parse (or a boot-time throw on a negative TTL) is the correct fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-15)
