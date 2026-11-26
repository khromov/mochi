# [MEDIUM] getClientAddress() returns the forwarded header verbatim with no IP-format or length validation, and the value is used directly as a rate-limit store key

**File:** [`packages/mochi/src/runtime/proxy.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/proxy.ts#L90-L109) (lines 90, 106, 109)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-unvalidated-trust-input`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

For any non-`x-forwarded-for` header the function returns `value.trim()` unchanged (L109); for XFF it returns a split entry unchanged (L106). Nothing checks that the result is a well-formed IP address or bounds its length. That value flows straight into `addressKeys` and becomes the rate-limit store key (rateLimit.ts:222, 250), which for `rateLimitSqliteStore` / `rateLimitPostgresStore` is a persisted row key.

Two consequences once an attacker can influence the header (via the `xffDepth` issue above, or because the configured header — `true-client-ip` is the documented example at L24 — is one the proxy does not actually overwrite, which is the norm for `true-client-ip` outside Cloudflare Enterprise):

1. **Store-key namespace forgery.** hitlimit namespaces grouped keys as `group:<id>:<key>` (see the mirrored logic at rateLimit.ts:242). Mochi auto-groups a route's own limiter by its route pattern, while the shared global limiter passes no group. So an attacker hitting a globally-limited route with the address string `group:/some/other-route:198.51.100.5` writes to the exact key route `/some/other-route` uses for IP 198.51.100.5 — draining, and potentially banning, a victim's quota on a route the attacker never touched.
2. **Unbounded key growth.** A multi-kilobyte header value (well within Bun's header limits) becomes a persisted SQLite/Postgres key, one row per distinct value, with no cap.

## Recommendation

Validate the extracted value before returning it — reject anything that is not a valid IPv4/IPv6 literal (`Bun.isIP`-style check) and fall back to the socket address, which also closes the key-namespace forgery. At minimum, bound the length and reject values containing `:`-delimited `group:` prefixes or non-address characters.

## Revalidation

**Verdict:** true-positive

The mechanism is confirmed, with narrower preconditions than the write-up implies. `getClientAddress` returns the split XFF entry (L106) or the raw header (L109) with no IP-shape or length validation, and that string becomes the hitlimit key verbatim (rateLimit.ts:250 → :222), which for the sqlite/postgres stores is a persisted row key. I verified the namespace format in the pinned dependency rather than assuming it: `node_modules/@joint-ops/hitlimit-bun/dist/index.js:179` does `key = \`group:${groupId}:${key}\``, and it is applied only when `config.group` is truthy — which for Mochi means a route's own `rateLimit` gets `group = <route pattern>` (its `autoGroup`) while the shared global limiter passes nothing (Mochi.ts:808 vs :823, rateLimit.ts:213). So an address string of `group:/some/route:<victimIP>` sent to a globally-limited route collides exactly with the row the grouped route uses for that victim, defeating an invariant the docs state as a guarantee (122-rate-limiting.md:85: 'different routes backed by the same database keep separate counters'). Two preconditions gate it: the attacker must be able to influence the address at all — which itself requires a misconfiguration the module docstring and a `danger` callout warn against, or the F3 padding trick — and the two limiters must share one store instance (plausible: 122-rate-limiting.md:93-98 explicitly tells you to create one store and share it). Given that precondition the attacker already owns the rate-limit identity, so the incremental impact (cross-route poisoning, multi-KB persisted keys) is modest, and one supporting detail is wrong: support/routes.ts:110 *renders* `getClientAddress()` on the admin page, it does not persist it. Still a real, cheaply-fixable defect — validating the extracted value as an IPv4/IPv6 literal closes the forgery and the unbounded-key growth outright.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
