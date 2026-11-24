# [BUG] Unauthenticated, unthrottled hard cache invalidation affecting all visitors

**File:** [`packages/site/src/demos/image-invalidation/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/image-invalidation/routes.ts#L13-L24) (lines 13, 22, 23, 24)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `default` form action (L22-26) is reachable by any unauthenticated internet client and performs a destructive, cross-user, CPU-amplifying operation with no rate limit.

Each POST calls `invalidateImage(sourceUrl(), { hard: true })`, which per `imageApi.ts` L335-338 hard-evicts the shared cached *original* and therefore cascades to every named variant derived from it, then increments the module-global `generation` counter (L13, L24). Because `generation` is process-global and is rendered into every image URL as the `&g=` cache-buster (ImageInvalidationDemo.svelte L17), a single attacker's POST invalidates the browser cache for *all* visitors of that page, not just their own session. The subsequent GET then forces a fresh loopback HTTP fetch of `source.jpg` plus up to four `Bun.Image` decode/encode passes (the original plus the `hero`, `card`, and `thumb` sizes rendered on the page) before the page can be served.

An attacker can therefore loop POST/GET to keep the image cache permanently cold, converting each cycle into a loopback request plus four image transforms on the server. CSRF is not a mitigation here: `csrfCheck` only compares the `Origin` header, so a direct `curl -X POST -H 'Origin: <site origin>'` passes it trivially — it blocks a victim's browser from being used, not a scripted attacker.

No rate limiting applies. Rate limits in this framework are opt-in per route (`Mochi.api(..., { rateLimit })`), `packages/site` configures no global limit, and this route declares none — even though sibling routes in the same `routes.ts` do (e.g. `/api/captcha-demo/verify` with `{ limit: 30, window: '1m' }`), showing the mechanism was available and known.

## Recommendation

Add a per-route rate limit to the page route, matching the pattern already used elsewhere in `routes.ts` (e.g. `{ rateLimit: { limit: 5, window: '1m' } }`), so the invalidate action cannot be driven in a loop. Consider scoping the cache-buster to the caller (a cookie or session value) instead of a process-global counter, so one client's invalidation does not force a cold cache and re-encode for every other visitor.

## Revalidation

**Verdict:** true-positive

The core mechanism checks out. `/demos/image-invalidation` is a public `Mochi.page` with a `default` action and no `rateLimit`; `packages/site`'s `Mochi.serve()` sets no global limiter (index.ts has no `rateLimit` key) and `protection.protect` is scoped to `/demos/protection*` only, so nothing throttles the POST. `invalidateImage(src, { hard: true })` → `cache.invalidateOriginal(src, true)` (image/imageCache.ts L330-352) does `cascadeSource()` then `delete(origKey)`, evicting the placeholder and *every configured size's* variant — ~20 entries for this site's `image.sizes` map. `generation` is module-global, so one anonymous POST bumps the `&g=` nonce for all visitors, and Origin-only `csrfCheck` is indeed no obstacle to a scripted `curl` with a spoofed `Origin`. Sibling demo POST actions in the same repo (`reload-form-data`, `queue`) do carry `{limit: 60, window: '1m', skip: req.method !== 'POST'}`, so this route deviates from the project's own convention — that is the real, actionable defect. Two claims are wrong, which is why I'm downgrading severity. First, the page GET does *not* perform the loopback fetch or the four transforms: `getImageUrl` → `mintFor` → `mintImageUrl` only runs `encryptImageRequest` (image/imageApi.ts L48, L86-101) — all fetch/decode work happens on the separate `/_mochi/image/*` requests, so the attacker needs 5 requests per cycle, not 2, and the render never blocks on it. Second, the deployed container runs `development: true`, where `resolveImageCacheControl` deliberately emits no `Cache-Control` for images (image/imageEndpoint.ts L45-50), so there is little browser cache for the nonce to bust. What remains is a modest unauthenticated CPU-amplification and a global counter mutable by anonymous users, on demo code whose advertised purpose is exactly this button — a low-priority hardening bug, not a MEDIUM security issue.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
