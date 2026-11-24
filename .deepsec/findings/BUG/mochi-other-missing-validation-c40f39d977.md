# [BUG] minAgeMs, maxAgeMs, store and storePath are not validated, and a NaN maxAgeMs silently disables token expiry

**File:** [`packages/mochi/src/captcha/config.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/config.ts#L36-L92) (lines 36, 37, 38, 39, 40, 59, 60, 92)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-missing-validation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

resolveCaptchaOptions bounds-checks three options — bits (L33-35), driftAllowanceMs (L44-46) and solveBudgetMs (L50-52) — but leaves the rest unchecked, and the gaps are consequential because all NaN comparisons are false. (1) `maxAgeMs: NaN` passes the only guard at L38 (`minAgeMs >= NaN` is false), yielding limitMs = NaN in verifyCaptcha, so its expiry check `ageMs > limitMs` is always false and tokens never expire; expiresAt becomes NaN, so MemoryNonceStore's `exp < now` prune never fires either and the replay map grows permanently, while SqliteNonceStore binds NaN against an INTEGER NOT NULL column and throws. (2) `minAgeMs: NaN` likewise passes L38 and only surfaces later as the misattributed filter error in captcha.ts:97, at request time rather than boot. (3) `store` (L59) is never shape-checked, so createStore's fallthrough at L92 returns an unsupported value verbatim as a NonceStore — `store: 'redis'` yields a request-time 'store.consume is not a function' TypeError instead of a boot-time config error (it does at least fail closed rather than open). Real-world evidence that the burden has landed on applications: packages/support/src/index.ts:55-58 hand-rolls all three guards — `Number(env) || DEFAULT` for bits, an explicit `Number.isFinite(...)` ternary for minAgeMs, and a literal-union narrowing for store — precisely because the framework provides none. That app's own guard still has a hole: `CAPTCHA_MIN_AGE_MS=""` makes `Number('')` 0, which is finite, so an empty-but-set env var silently drops the captcha timing floor to zero on the production support form.

## Recommendation

Validate minAgeMs and maxAgeMs with the same `Number.isFinite(x) && x >= 0` (and `maxAgeMs > 0`) pattern already used for driftAllowanceMs and solveBudgetMs, and validate `store` up front — accept the literals 'memory'/'sqlite' or an object exposing a callable `consume`, and throw a clear boot error otherwise instead of letting createStore fall through at L92.

## Revalidation

**Verdict:** true-positive

I walked each sub-claim through the code. resolveCaptchaOptions bounds-checks `bits` (L33-35), `driftAllowanceMs` (L44-46) and `solveBudgetMs` (L50-52) but not `minAgeMs`, `maxAgeMs`, `store` or `storePath`, and because every NaN comparison is false the single remaining guard at L38 (`minAgeMs >= maxAgeMs`) is porous in both directions. (1) `maxAgeMs: NaN`: `2000 >= NaN` is false so it passes; at verify `limitMs = NaN + 30_000 = NaN`, the L96 guard is also bypassed (`2000 >= NaN` is false, and `Number.isFinite(2000)` holds), and the expiry test `ageMs > limitMs` is then always false — token expiry is silently off. `expiresAt = iat + NaN = NaN`, so MemoryNonceStore's `exp < now` prune never fires and the map grows without bound, while SqliteNonceStore binds a non-finite value against `expires_at INTEGER NOT NULL` and throws (SQLite stores NaN as NULL). (2) `minAgeMs: NaN` likewise clears L38 and surfaces only at request time as the misattributed filter error at captcha.ts:97 — which is the same defect F4 covers from the other file. (3) `store` is unvalidated and createStore's fallthrough at L92 returns it verbatim, so a bogus literal becomes a request-time `store.consume is not a function` TypeError rather than a boot error; TypeScript blocks this for typed callers, so it needs JS or a cast, and it does fail closed. The cited real-world evidence is accurate: support/src/index.ts:55-58 hand-rolls `Number(env) || DEFAULT`, an explicit `Number.isFinite(...)` ternary, and a literal-union narrowing — exactly the guards the framework omits — and that app's own hole is real too, since `Number('')` is `0` and finite, so `CAPTCHA_MIN_AGE_MS=""` drops the production support form's timing floor to zero. BUG is correct: the security control (expiry) genuinely disappears, but only via an application passing a non-finite value, which `Number(process.env.X)` on an unset variable makes a plausible mistake rather than an attacker-reachable one.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
