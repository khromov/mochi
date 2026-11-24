# [BUG] Agent-name allowlist in resolveTarget is bypassed by prototype-chain keys

**File:** [`packages/mochi/src/cli/cli.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/cli.ts#L70) (lines 70)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`resolveTarget` (L66-71) validates the agent positional against `SKILL_TARGETS`, then falls through to `TARGET_ALIASES[name] ?? null`. `TARGET_ALIASES` is a plain object literal, so the bracket lookup walks `Object.prototype`: `update-skill constructor`, `update-skill __proto__`, `update-skill toString` and friends all yield a truthy non-target value, pass the `if (!target)` check, and are handed to `updateSkill({ target })`. `SKILL_DESTS[thatValue]` is then `undefined`, so `path.resolve(cwd, undefined)` (updateSkill.ts L78) throws `TypeError: The "path" argument must be of type string`.

Impact is limited to error quality — the throw is caught by `runUpdateSkill`'s try/catch and the process still exits 1 — but the user gets a confusing internal TypeError instead of the intended `[mochi] Unknown agent: … Valid agents: …` message, and the allowlist's `cli.test.ts` coverage (`'bogus'`) doesn't exercise the hole. Worth fixing as a validation-hygiene matter: the same pattern in a context where the resolved value *is* a usable key would be a real allowlist bypass.

## Recommendation

Guard the lookup with an own-property check: `return Object.hasOwn(TARGET_ALIASES, name) ? TARGET_ALIASES[name] : null;` (or build the map with `Object.create(null)` / a `Map`). Add a test asserting `update-skill __proto__` produces the "Unknown agent" message.

## Revalidation

**Verdict:** true-positive

Confirmed by reading resolveTarget (cli.ts L66-71). `SKILL_TARGETS` is `Object.keys(SKILL_DESTS)`, so the `includes` check fails for prototype keys, and the fallback `TARGET_ALIASES[name] ?? null` on a plain object literal walks `Object.prototype`: `__proto__` yields `Object.prototype`, `constructor` yields the `Object` function, `toString`/`valueOf`/`hasOwnProperty` yield functions — all truthy, all passing `if (!target)` at L76, all handed to `updateSkill({ target })`. I then traced the consequence precisely: `SKILL_DESTS[target]` coerces the key to a string (`'[object Object]'`, `'function Object() { [native code] }'`), misses, and `path.resolve(cwd, undefined)` at updateSkill.ts L78 throws `TypeError [ERR_INVALID_ARG_TYPE]`, which `runUpdateSkill`'s catch (cli.ts L108-112) prints and exits 1 on. I checked whether any `Object.prototype` key could stringify into a usable `SKILL_DESTS` key — none can — so there is no path traversal and no write to an unintended destination; the impact really is confined to error-message quality. One ordering detail the finding omits: `updateSkill` fetches (L67) *before* computing `dest` (L78), so with `MOCHI_SKILL_URL` unset and the live mochi.fast URL still 404ing (per cli.test.ts's own comment), the HTTP-404 error usually fires first and the TypeError is only reached when the fetch succeeds. Either way the user gets an internal error instead of the intended '[mochi] Unknown agent: … Valid agents: …' message, and cli.test.ts only exercises `'bogus'`, so the hole is uncovered. Worth fixing as validation hygiene exactly as described — `Object.hasOwn` or `Object.create(null)`/`Map` — since the same pattern elsewhere, where the resolved value *is* a usable key, would be a real allowlist bypass.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
