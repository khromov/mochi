# [BUG] `requestMemo` default key uses an unescaped NUL separator, so distinct argument tuples can collide

**File:** [`packages/mochi/src/runtime/requestCache.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/requestCache.ts#L198-L204) (lines 198, 201, 204)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-cache-key-collision`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`defaultKey` joins type-tagged argument parts with `\0` (L198) but `keyPart` never escapes a `\0` occurring inside a string argument (L203-204 returns `s:${arg}` verbatim). So `memo('a\u0000s:b')` and `memo('a', 'b')` both produce the key `…:s:a\u0000s:b`, and the second caller silently receives the first's cached value. This directly defeats the invariant the code comments claim at L196 ('Type-tagged so `1` and `'1'` stay distinct'). A real NUL is reachable from untrusted input: `%00` in a query string or route param decodes to `\u0000` via `URLSearchParams`/`extractParams`, so an attacker chooses the colliding key. Blast radius is bounded — the store dies with the request, so an exploit needs two `requestMemo` call sites in one render whose arguments can be made to collide (e.g. a `(userId, resourceId)` permission memo consulted for two subjects while rendering one page) — which is why this is a correctness bug rather than a cross-tenant vulnerability, but the same shape in a per-request authorization memo would be one.

## Recommendation

Escape the separator inside string parts, or make the key length-prefixed: e.g. return `s:${arg.length}:${arg}` from `keyPart` (and likewise for the JSON case), or JSON-escape every part so a NUL cannot be forged. A unit test asserting that `['a\u0000s:b']` and `['a','b']` key differently would pin the behavior.

## Revalidation

**Verdict:** true-positive

Verified against the current file; the keying logic is unchanged since `feat: request cache (#202)` (the only later commit, 82b29f6b, slimmed comments). The claim is provably correct: `defaultKey` (L197-199) joins parts with a literal NUL via `.join('\0')`, while `keyPart`'s string branch (L203-204) returns `s:${arg}` with no escaping, so the key function is not injective over strings containing NUL. The finding's example checks out exactly — `['a\u0000s:b']` yields `s:a\u0000s:b` and `['a','b']` yields `['s:a','s:b'].join('\0')` = `s:a\u0000s:b`, the same string — and `getOrSetIn` (L70-91) then returns `state.map.get(key)` with no re-validation of arguments, so the second caller silently receives the first's value. The defect is actually broader than filed: it does not require variadic arity. At fixed arity 2, `('x','y\u0000s:z')` and `('x\u0000s:y','z')` both produce `s:x\u0000s:y\u0000s:z`, so even a rigid two-string signature collides. I confirmed NUL is the only forgeable separator and that it can only enter through a string argument: `JSON.stringify` escapes control characters (`{"a":"\u0000"}`), so the object branch at L218 is immune, and the number/boolean/bigint/undefined/null tags cannot contain one. The untrusted-input claim holds — `extractParams` (utils/index.ts L138) is a bare passthrough of Bun's `req.params`, `?x=%00` decodes to U+0000 through WHATWG `URLSearchParams`, and a JSON body or FormData text value carries a literal NUL trivially; nothing on the path sanitizes, since `cacheWith` hands the key straight to a `Map` and `wrap()` exposes raw `get/set/has`. This also breaks a publicly documented contract, not merely the L196 comment: `packages/docs/146-request-cache.md` L45 states arguments are keyed by a type-tagged serialization where `1` and `'1'` never collide, and `requestMemo` is exported from `index.ts` L25. I agree with the filed BUG severity rather than escalating: the store lives on `ctx.requestCache` and dies with the request (no cross-request or cross-tenant bleed), and each wrapper gets a unique default namespace (`memo:${++memoCounter.n}`), so colliding entries must come from a single wrapper — and of the four framework wrappers, `getCachedOriginal` overrides `key`, `imagePlaceholder`/`getImagePlaceholder` are arity-1 (a single part, never joined, hence injective), and only `cachedImageDimensions(src, size)` uses multi-arg `defaultKey`, where the args are `Image.svelte` props and the worst outcome is a wrong or null `width`/`height` because `readCachedDimensions` merely reads already-cached variant metadata and `resolveNamed` nulls any unknown size. So it is a genuine correctness bug in a public API with a security-relevant shape in application code, exactly as the finding frames it, and the recommended length-prefixed or escaped keying fixes it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
