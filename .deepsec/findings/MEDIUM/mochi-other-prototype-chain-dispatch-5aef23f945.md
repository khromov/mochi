# [MEDIUM] Form action name resolved through the prototype chain, bypassing the unknown-action 404 and forcing 500s

**File:** [`packages/site/src/demos/form-redirects/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/form-redirects/routes.ts#L10-L12) (lines 10, 11, 12)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-prototype-chain-dispatch`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This route declares `actions` as a plain object literal (prototype = Object.prototype). The framework dispatches it at packages/mochi/src/Mochi.ts:1050-1058: `actionName` is taken from the first query-string key beginning with '/' (fully attacker-controlled), then looked up with a bare index — `const actionHandler = livePostActions[actionName]` — guarded only by `if (!actionHandler)`. Inherited Object.prototype members are truthy, so they defeat that guard.

Attack (unauthenticated, no browser needed — Origin-header CSRF stops cross-site browser requests but not a direct client that sets `Origin: https://mochi.fast` with `Content-Type: application/x-www-form-urlencoded`):

1. `POST /demos/form-redirects/?/toString` → `livePostActions['toString']` resolves to `Object.prototype.toString`, which is callable. It is invoked with `this === undefined` (ESM strict mode) and returns the string `'[object Undefined]'`. That value is not a Response, and `isRedirect`/`isFormFail`/`isFormSuccess` all reject a string, so execution falls to Mochi.ts:1165-1167 and the page re-renders at **HTTP 200** with `ctx.form = { ok: true, action: 'toString', data: {} }`, emitting `action:complete` with `result: 'success'`. An action that does not exist produces a successful-submission render instead of the intended 404 — any page whose component branches on `form.ok` to show confirmation UI or kick off follow-up client logic can be driven into that state.
2. `POST /demos/form-redirects/?/__proto__` → resolves to `Object.prototype` (truthy, not a function); `?/valueOf` and `?/hasOwnProperty` resolve to functions that throw when `this` is undefined. Each raises a TypeError at Mochi.ts:1102, caught at :1115 and mapped to **500** (`err instanceof MochiHttpError ? err.status : 500`, Mochi.ts:742), rendering the full error page and firing `emitError('action', …)`. This is a cheap, unauthenticated way to force 500s and error-telemetry noise on every page route in the app that declares actions, not just this demo.

No RCE: only one lookup level is performed, and `actions['constructor']` is `Object`, so `Object(arg)` merely returns its argument.

The same hazard is explicitly defended against elsewhere in this codebase, which shows the dispatch site simply missed it: packages/mochi/src/image/config.ts:82-83 uses `Object.create(null)` with the comment "would resolve names like 'toString' or '__proto__' through the prototype chain" (plus `Object.hasOwn` at :164-166), and packages/site/src/lib/highlight.server.ts:33-41 uses a null-prototype map and `Object.hasOwn` for the same reason. The action dispatch — the only one of the three whose key comes straight off the query string — has neither.

## Recommendation

Fix at the framework dispatch rather than per-route: in packages/mochi/src/Mochi.ts:1057, require an own property — `const actionHandler = Object.hasOwn(livePostActions, actionName) ? livePostActions[actionName] : undefined;` — and additionally assert `typeof actionHandler === 'function'` before invoking, falling through to the existing 404 branch otherwise. Normalizing the registered map at registration time (`Object.assign(Object.create(null), actions)`, mirroring image/config.ts:83) hardens it a second way. Consider also validating `actionName` against a conservative charset (e.g. /^[A-Za-z0-9_-]+$/) so the name echoed into the 404 message and into `action:*` events stays bounded. Worth a regression test for `?/__proto__`, `?/constructor`, `?/toString` and `?/valueOf` → 404, alongside the existing `?/missing` case in packages/mochi/src/runtime/enhance.test.ts:286.

## Revalidation

**Verdict:** true-positive

Confirmed in full, including every supporting claim. `MochiFormActions` is `Record<string, MochiFormActionHandler>` (types.ts:153) and this route declares it as an object literal, so the prototype is `Object.prototype`. At Mochi.ts:1050-1058, `actionName` is the first query-string key starting with '/' — fully attacker-controlled — and the lookup is a bare `livePostActions[actionName]` guarded only by `if (!actionHandler)`, which inherited members defeat. Both branches of line 1045 hand over the user's literal unchanged: `pageConfigMap` is dev-only (line 767) and stores the same object reference (line 891), while production captures `actions` directly, so this reproduces in both modes. `?/toString` resolves `Object.prototype.toString`, truthy and callable; `packages/mochi/package.json` is `"type": "module"`, so ESM strict mode makes `this === undefined` and the call returns the string '[object Undefined]'. I verified all three result predicates are marker-based and reject a string (`typeof v === 'object'` short-circuits — forms.ts:37-47), so execution falls to lines 1165-1167 and the page re-renders at HTTP 200 with `ctx.form = { ok: true, action: 'toString', data: {} }` plus an `action:complete` 'success' event — a nonexistent action producing a successful-submission render instead of the intended 404. `?/__proto__` resolves to `Object.prototype`, truthy but not callable, so the invocation at 1102 throws TypeError, is caught at 1115, and maps to 500 via `routeErrorResponse`; that half holds regardless of strict mode. `?/valueOf` and `?/hasOwnProperty` throw the same way under strict mode. No RCE: only one lookup level, and `?/constructor` gives `Object`, which merely returns its argument. The precedent argument is the strongest part and it is accurate: image/config.ts:82-83 uses `Object.create(null)` with a comment naming this exact hazard, `getSize` adds `Object.hasOwn` (:164-166), and config.test.ts:82 already regression-tests `['toString','constructor','hasOwnProperty','__proto__']`; highlight.server.ts:33-41 does the same with `Object.assign(Object.create(null), aliases)` + `Object.hasOwn`. The action dispatch — the only one of the three whose key comes straight off the query string — has neither, and enhance.test.ts:286 covers only `?/missing`. Impact is bounded (no cross-user reach, since production CSRF stops browser-driven cross-site POSTs, so it is self-inflicted state confusion plus unauthenticated 500/error-telemetry generation on every action route of every Mochi app), which keeps it at MEDIUM rather than higher. The fix belongs at Mochi.ts:1057 (`Object.hasOwn` + a `typeof === 'function'` assertion), as the finding recommends.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
