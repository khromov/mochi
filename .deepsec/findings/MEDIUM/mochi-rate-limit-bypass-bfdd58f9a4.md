# [MEDIUM] An xffDepth larger than the real proxy chain lets a padded X-Forwarded-For set getClientAddress() to any attacker-chosen value

**File:** [`packages/mochi/src/runtime/proxy.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/proxy.ts#L95-L106) (lines 95, 103, 104, 105, 106)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`getClientAddress` reads `ips[ips.length - depth]` with a fallback of `ips[ips.length - 1]` (L103-106). The comment claims this is safe ("An `xffDepth` larger than the chain falls back to the rightmost, closest-proxy entry: the leftmost is fully client-controlled and spoofable") and proxy.test.ts:151-154 pins that claim. The guarantee is illusory, because the attacker controls the chain *length*: the fallback only fires when `ips.length < depth`, and one extra comma defeats it.

Concrete scenario — operator deploys behind one appending proxy but sets `xffDepth: 2` (an easy off-by-one; the docs phrase it as "number of trusted proxies in front of the server", and people routinely count a CDN plus a load balancer when only one appends). The attacker sends `X-Forwarded-For: 198.51.100.9`; the proxy appends the real client, giving `198.51.100.9, <realClient>`. Now `ips.length === 2`, `depth === 2`, index 0 → the attacker's own value is returned as the client address.

`getClientAddress()` is the default rate-limit key (rateLimit.ts:222, 250), so the consequences are: (1) unlimited rate-limit evasion by rotating the header per request; (2) targeted denial of service against a third party — submit abusive traffic with `X-Forwarded-For: <victim IP>` and the configured `ban` (rateLimit.ts:234) bans the victim rather than the attacker; (3) forged audit trails, e.g. `packages/support/src/routes.ts:110` persists `ctx.getClientAddress()`. A correctly-set depth is robust (I verified the 1- and 2-proxy cases), so this is strictly a silent, insecure degradation under a misconfiguration the framework cannot detect but also does not flag. This repo's own apps use the safe `xffDepth: 1`.

## Recommendation

When `ips.length < depth` the chain is shorter than configured — return `fallback` (Bun's connecting socket IP, the only unspoofable value) rather than a header-derived entry, and log a one-time warning naming the mismatch. Drop the safety claim from the comment and the test, since reading from the right only blocks spoofing when `xffDepth` exactly matches the number of appending hops.

## Revalidation

**Verdict:** true-positive

The arithmetic is exactly as described. `ips[ips.length - depth] ?? ips[ips.length - 1]` (proxy.ts:106) only falls through to the `??` branch when the computed index is negative, i.e. strictly when `depth > ips.length`; at `depth === ips.length` the index is 0 — the leftmost, wholly client-supplied entry. Since the attacker controls the chain length by pre-seeding the header, one padding entry converts the 'safe' over-configured case into full control: with one appending proxy (nginx's `$proxy_add_x_forwarded_for` preserves the inbound value and appends `$remote_addr`) and `xffDepth: 2`, a request carrying `X-Forwarded-For: 198.51.100.9` arrives as `198.51.100.9, <realClient>`, length 2, depth 2, index 0 → the attacker's own string is returned. So the in-code safety claim at L104-105 and the test that pins it (proxy.test.ts 'xffDepth deeper than the chain … never the spoofable leftmost') are both wrong for the padded case. The downstream impact is confirmed: `createRouteLimiter`'s default key generator reads the stashed `getClientAddress()` value (rateLimit.ts:218-222, 249-251), and hitlimit bans by that same key, so rotating the header evades limits and sending a victim's IP burns the victim's quota and can trip the configured `ban` (rateLimit.ts:234) against them. Preconditions are honest in the finding and I verified them: a correctly-matched depth is robust, and this repo's apps all use `xffDepth: 1`. The precondition is an operator error that 160-serve-options.md does warn about in prose ('Pass the right xffDepth'), which caps the practical severity — but the defect is that the framework's documented *mitigation* for getting it wrong does not actually hold, so MEDIUM stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
