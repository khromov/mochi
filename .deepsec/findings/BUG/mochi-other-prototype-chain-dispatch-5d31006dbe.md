# [BUG] Form-action dispatch resolves `Object.prototype` members, yielding forged `form.ok: true` renders and unauthenticated 500s

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1051-L1165) (lines 1051, 1057, 1058, 1165)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-prototype-chain-dispatch`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The POST action handler derives the action name from the first query key starting with `/` (L1051-1056) and then looks it up on the user-supplied actions object with plain bracket access: `const actionHandler = livePostActions[actionName]` (L1057). `MochiFormActions` is `Record<string, handler>` — in practice an object literal — so the lookup walks the prototype chain.

- `POST /page?/constructor` resolves to `Object`. It is a function, so the 'unknown action → 404' branch (L1058) is skipped and it is invoked as the action handler: `Object(eventObject)` returns the event object. That value is not a `Response`, not `isRedirect`, not `isFormFail`, not `isFormSuccess`, so execution falls to L1165-1168: `ctx.form = { ok: true, action: 'constructor', data: {} }`, `emitActionComplete(actionName, 'success')`, and the page re-renders with HTTP 200 and a *successful* form result the app never produced. On the `enhance` JSON path (L1158-1163) the client receives `{type:'success', status:200, data:{}}` and runs its success handling (form reset, success callbacks). The same holds for `?/toString`, `?/valueOf`, `?/hasOwnProperty`, `?/propertyIsEnumerable`.
- `POST /page?/__proto__` resolves to `Object.prototype` — truthy but not callable — so `await actionHandler(...)` throws `TypeError`, which the catch at L1115 turns into a 500 error page via `routeErrorResponse`. Any unauthenticated client can force a 500 (and 5xx error-log noise plus bogus `action:complete`/`error` bus events) on every action-bearing page route.

The Origin CSRF check does not prevent this: it only stops *browser-driven* cross-site submissions, while a direct client (curl with a matching `Origin` header) passes freely. The codebase already recognises this bug class and fixes it elsewhere — `image/config.ts:166` uses `Object.hasOwn(options.sizes, name)` with the comment "guards a `sizes` that arrived as a plain object literal ... against prototype-chain hits like 'constructor'", and `image/config.test.ts:80` asserts it for `toString`/`constructor`/`hasOwnProperty`/`__proto__`. The same guard is missing here.

## Recommendation

Mirror `getSize`: `const actionHandler = Object.hasOwn(livePostActions, actionName) ? livePostActions[actionName] : undefined;` and additionally require `typeof actionHandler === 'function'` before invoking, so a non-function hit 404s instead of throwing. Consider validating the action name against a conservative charset (`/^[A-Za-z0-9_-]+$/`) at the same point, and add a regression test for `?/constructor` and `?/__proto__` alongside the existing image-size test.

## Revalidation

**Verdict:** true-positive

The mechanism is exactly as described. Mochi.ts:1051-1056 derives `actionName` from the first `/`-prefixed query key with no charset validation, then line 1057 does `const actionHandler = livePostActions[actionName]`, and `MochiFormActions = Record<string, MochiFormActionHandler>` (types.ts:153) is in practice an object literal, so the lookup walks the prototype chain. `?/constructor` resolves to `Object` — truthy, so the 404 branch at 1058 is skipped — and `Object(eventObject)` returns the event object, which is not a `Response`, not `isRedirect`, not `isFormFail`, not `isFormSuccess`, so execution falls through to 1165-1167: `ctx.form = { ok: true, action: 'constructor', data: {} }` plus `emitActionComplete(..., 'success')` and a 200 re-render (or `{type:'success'}` JSON on the enhance path). `?/__proto__` resolves to `Object.prototype`, which is truthy but not callable, so `await actionHandler(...)` throws a TypeError caught at 1115 and turned into a 500 error page. The repo's prior art is exactly where the finding says: image/config.ts:164-166 uses `Object.hasOwn(options.sizes, name)` with the comment about 'prototype-chain hits like "constructor"', and image/config.test.ts:80-87 asserts it for toString/constructor/hasOwnProperty/__proto__. I repo-wide grepped for `Object.hasOwn`/`__proto__` guards and found none on the action-dispatch path, so it is genuinely unfixed. Downgrading MEDIUM→BUG on impact: `csrfCheck` does block the browser-driven cross-site path (form content types are protected on POST), so a cross-origin page cannot make a victim's browser trigger this; a direct client (curl with a matching Origin) only forges success in its own response. What remains is an unauthenticated forced 500 per request plus bogus `action:complete`/`error` bus events — a real robustness/log-integrity defect, not a cross-privilege vulnerability.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
