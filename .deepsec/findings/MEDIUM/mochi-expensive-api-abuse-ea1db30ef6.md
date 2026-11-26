# [MEDIUM] fetchUser and fetchStoryIds proxy an uncached third-party API call per request with no rate limiting

**File:** [`packages/demos/src/hn/hn-api.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/hn-api.ts#L47-L56) (lines 47, 48, 55, 56)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `expensive-api-abuse`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`fetchItem` (L33-45) is carefully hardened: it validates the id and funnels through `itemCache`, with a comment explaining that every caller goes through it 'so rejecting junk ids stops both bogus cache keys and pointless upstream fetches'. `fetchUser` (L47-53) and `fetchStoryIds` (L55-61) do neither — no validation, no cache.

Attack path: `/hn/user/:id` is a public `Mochi.page` whose `params.id` flows unvalidated into `fetchUser` (HNUser.svelte:10). Worse, that page then renders `<HNRecentSubmissions mochi:defer userId={user.id}>`, and the island calls `fetchUser(userId)` a *second* time (HNRecentSubmissions.svelte:9) even though the page already holds the `submitted` array it needs — so one page view costs two uncached upstream requests. `/hn/front` similarly re-fetches the entire ~500-id story list from `hacker-news.firebaseio.com` on every single request.

There is no abuse protection anywhere in the app: grepping `packages/demos/src` for `rateLimit`, `protection`, and `captcha` returns nothing, and `Mochi.serve()` in index.ts sets none — despite `rateLimit` being available both globally (types.ts:678) and per-route (types.ts:50). An unauthenticated attacker can therefore use the deployed demo as an unmetered amplifier against a third-party API (1 attacker request -> 1-2 upstream requests from the server's IP), risking the server's IP being throttled or blocked by the upstream and degrading the site for everyone.

`fetchUser` also accepts an arbitrary-length, arbitrary-content path segment — `encodeURIComponent` prevents any path escape (no `/ ? # :` survives, and the origin is a module constant, so this is *not* SSRF), but a multi-kilobyte username is still forwarded upstream verbatim.

## Recommendation

Route `fetchUser` and `fetchStoryIds` through a `MochiCache` the way `fetchItem` already is (a short TTL is enough for story lists), validate the username against HN's actual charset/length before building the URL, pass the already-fetched `recentIds` into `HNRecentSubmissions` instead of re-fetching the user, and add a `rateLimit` to `Mochi.serve()` in packages/demos/src/index.ts or to the `/hn/*` routes.

## Revalidation

**Verdict:** true-positive

Every factual claim checks out. `fetchItem` (hn-api.ts:33-45) validates with `Number.isSafeInteger(id) && id > 0` and funnels through `itemCache`, with the comment stating the intent; `fetchUser` (47-53) and `fetchStoryIds` (55-61) do neither. `/hn/user/:id` is a public `Mochi.page` (routes.ts:12) and `params.id` reaches `fetchUser` unvalidated at HNUser.svelte:10. The double fetch is confirmed: HNUser.svelte:40 renders `<HNRecentSubmissions mochi:defer userId={user.id}>` and HNRecentSubmissions.svelte:9 calls `fetchUser(userId)` again purely to re-read `submitted`, which the page already holds. `fetchStories` -> `fetchStoryIds` runs uncached on every render of `/hn/front|new|ask|show|jobs`, which are the nav targets at HNLayout.svelte:25-31, so the ~500-id array is re-pulled from Firebase per request. And there is no abuse control anywhere: my grep of packages/demos/src for `rateLimit|protection|captcha` returns zero hits and `Mochi.serve()` sets none, even though commit 1289d8f8 established the pattern of adding per-route limits to demo routes. I would temper one phrase: at 1 attacker request -> 1-2 upstream requests this is not really an 'amplifier', so the credible harm is the server's IP being throttled or blocked by hacker-news.firebaseio.com (degrading the demo for everyone) plus per-request latency pinned to an uncached third-party call, not bandwidth amplification. I independently confirmed the finding's own disclaimer that this is not SSRF: `encodeURIComponent` percent-encodes `/ ? # :` and `BASE` is a module constant, and a `..` segment cannot traverse because `${BASE}/user/${'..'}.json` yields the single segment `...json`. Real, worth fixing, MEDIUM is fair.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-06)
