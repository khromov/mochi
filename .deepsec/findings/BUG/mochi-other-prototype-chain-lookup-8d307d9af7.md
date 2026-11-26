# [BUG] Route param indexed straight into an object literal: inherited Object.prototype members pass the 404 guard and crash the handler

**File:** [`packages/site/src/shot/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/shot/routes.ts#L11-L20) (lines 11, 12, 13, 20)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-prototype-chain-lookup`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`serverProps` takes the `:name` route param unvalidated and uses it as a key into the `subjects` object literal (`const subject = subjects[name]`, L12-13). `subjects` is a plain object literal (registry.ts:15), so the lookup also resolves inherited `Object.prototype` members. `subjects['__proto__']` returns `Object.prototype`, `subjects['constructor']` returns `Object`, and `subjects['toString']`/`['valueOf']`/`['hasOwnProperty']` return functions — all truthy, so every one of them sails past the `if (!subject)` 404 guard at L13-15 that is supposed to be the only way past this point. Execution then reaches L20, where `subject.natural` is `undefined` and `fitScale(frame, undefined)` dereferences `natural.width` (registry.ts:49), throwing `TypeError: Cannot read properties of undefined (reading 'width')`. The throw escapes `serverProps`, is caught by the page route handler and routed through `routeErrorResponse`, producing an unauthenticated HTTP 500 plus a `logger.error` entry for every request. The route is mounted unconditionally in production (`...shotRoutes` in packages/site/src/routes.ts:405, no `DEVELOPMENT` guard), and because pages are registered in both slash forms (Mochi.ts:1546-1552) `GET /shot/__proto__/` reaches the handler directly under the site's `trailingSlash: 'always'` policy. Impact is bounded: the intended 404 degrades to a 500 and pollutes error logs, but production discloses nothing (`runtime/errors.ts:93` gates `error.stack` behind `development`, and the message is the generic 'Internal Server Error'), and the cost per request is no higher than a normal page render — so this is an error-handling bug rather than an exploitable vulnerability. `subject.props(url)` at L20 is never reached, since `fitScale` throws first while evaluating the preceding property.

## Recommendation

Only accept own enumerable keys. Either guard the lookup (`if (!Object.hasOwn(subjects, name))` before using it), declare the map with a null prototype (`Object.assign(Object.create(null), { … })` in registry.ts), or switch `subjects` to a `Map` and use `subjects.get(name)` — any of which routes `/shot/__proto__/` to the intended 404 with the known-subjects list.

## Revalidation

**Verdict:** true-positive

Confirmed end to end. `subjects` is a plain object literal (registry.ts:15), so `subjects['__proto__']` resolves the inherited `Object.prototype` accessor and returns `Object.prototype` — truthy, so it sails past the `if (!subject)` 404 guard at routes.ts:13-15; same for `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `__defineGetter__`, etc. With no `?scheme=`, `readScheme` returns `'light'` (registry.ts:58-61), so the 400 guard also passes, and `frameSize` is fine. Execution then reaches L20, where `natural: subject.natural` evaluates to `undefined` without throwing, and the very next property, `scale: fitScale(frame, subject.natural)`, dereferences `natural.width` at registry.ts:49 → TypeError. Evaluation order confirms the finding's note that `subject.props(url)` is never reached. The throw escapes `serverProps`, which is awaited inside `renderComponent`, and is caught by the page `getHandler` (Mochi.ts:1012-1019) → `routeErrorResponse`, where a non-MochiHttpError maps to `{ status: 500, message: 'Internal Server Error' }` (runtime/errors.ts:120) with `error.stack` gated behind `development` (errors.ts:93). Reachability: `...shotRoutes` is mounted unconditionally at packages/site/src/routes.ts:405 (contrast `...(DEVELOPMENT ? leakTestRoutes : {})` at L385); `KIND_POLICY.page.trailingSlash` is true so Mochi.ts:1545-1552 registers the `/shot/:name/` mirror via `alternateSlashPattern`, and under the site's `trailingSlash: 'always'` (index.ts:172) `/shot/__proto__/` is already canonical, so `trailingSlashRedirect` returns null; GET is not in `DEFAULT_PROTECTED_METHODS` so CSRF doesn't intervene, and the site's `protect()` callback only covers `/demos/protection*`. So an unauthenticated `GET /shot/__proto__/` yields a 500 plus two error logs (framework `logger.error` + the site's own `handleError`). The impact assessment is honest: no information disclosure in production, and cost parity with a 404 (both render the configured error page), so there is no amplification — an error-handling bug, not a vulnerability. BUG is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
