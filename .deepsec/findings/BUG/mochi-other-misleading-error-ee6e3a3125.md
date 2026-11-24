# [BUG] A bad per-call or configured minAgeMs is reported as a captcha:minAgeMs filter fault

**File:** [`packages/mochi/src/captcha/captcha.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/captcha.ts#L95-L98) (lines 95, 96, 97, 98)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-misleading-error`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

At L95 the effective floor is `options?.minAgeMs ?? applyFilter('captcha:minAgeMs', resolved.minAgeMs, ...)`, so the value can originate from three places: the per-call option (which bypasses the filter entirely), the filter, or the configured default. The validation throw at L96-98 unconditionally attributes it to the filter: 'Captcha: the captcha:minAgeMs filter returned ${minAgeMs}'. Calling verifyCaptcha(formData, { minAgeMs: 1_000_000 }) in an application with no filter registered therefore produces an error naming a filter that does not exist. The same misattribution occurs for a configured `minAgeMs: NaN`, which slips through resolveCaptchaOptions (see the config.ts finding) and surfaces here as a phantom filter fault at request time rather than at boot.

## Recommendation

Track which source produced the value and name it in the message — 'the minAgeMs option passed to verifyCaptcha', 'the captcha:minAgeMs filter', or 'captcha.minAgeMs in Mochi.serve()' — so the operator is pointed at the code they actually have to change.

## Revalidation

**Verdict:** true-positive

Straightforwardly confirmed by reading L95-98. The effective floor is `options?.minAgeMs ?? applyFilter('captcha:minAgeMs', resolved.minAgeMs, …)`, so it can come from three sources: the per-call option (which short-circuits the filter entirely — captcha.test.ts:348-353 has a test asserting exactly that bypass), the filter, or the configured default. The throw at L96-98 is unconditional and always blames the filter: `Captcha: the captcha:minAgeMs filter returned ${minAgeMs}`. I verified both misattribution paths concretely. (1) `verifyCaptcha(formData, { minAgeMs: 1_000_000 })` in an app with no filter registered: `limitMs = 900_000 + 30_000 = 930_000`, so `1_000_000 >= limitMs` trips the guard and the operator is told a nonexistent filter misbehaved. (2) A configured `minAgeMs: NaN` slips resolveCaptchaOptions, because its only guard is `minAgeMs >= maxAgeMs` and `NaN >= 900_000` is false; it then fails `Number.isFinite` here, at request time, again naming a phantom filter. The existing test (captcha.test.ts:331-336) only exercises the genuine filter case, which is why the misattribution was never noticed. This is purely a diagnostics/developer-experience defect — no security impact, no behavioural change in the accept/reject decision — so BUG is the right severity, and the finding's own 'high' confidence is justified.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
