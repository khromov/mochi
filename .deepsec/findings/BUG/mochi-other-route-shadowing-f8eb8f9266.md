# [BUG] publicRouteKey leaves Bun route-pattern metacharacters raw, so a public filename containing ':' or '*' registers a dynamic/wildcard route

**File:** [`packages/mochi/src/runtime/publicDir.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/publicDir.ts#L35-L95) (lines 35, 36, 37, 88, 89, 95)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-route-shadowing`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`publicRouteKey` is `encodeURI(urlPath)` (L35-37), which by specification leaves `:`, `*`, `?` and `#` unencoded — and `publicDir.test.ts:86-89` deliberately pins that under-encoding to keep `,()` literal. But the resulting string is used directly as a **Bun route pattern** key (L88, L95), where `:` introduces a path parameter and `*` a catch-all. The framework already knows this: `warmup.ts:21` rejects a pattern containing `:` or `*` for exactly this reason.

So a file written to `public/` as `:id` or `*` does not register a static path — it registers `/:id` or `/*`, matching unrelated URLs and serving that one file's bytes at paths it was never meant to answer (shadowing the fallback/404 handler). The existing conflict guard cannot catch it: `if (routeKey in routes)` (L89) is an exact string comparison, so `/:id` never collides with a declared `/login`.

Benign for a hand-curated `public/` directory, but it becomes attacker-reachable in any app that writes user-supplied filenames into `publicDir` (an upload feature), where a crafted name hijacks a URL subtree. Separately, `?` and `#` surviving `encodeURI` means a file named `a?b.txt` registers a key containing a query separator and is simply unreachable.

## Recommendation

Percent-encode Bun's route metacharacters after `encodeURI` — `.replace(/:/g, '%3A').replace(/\*/g, '%2A').replace(/\?/g, '%3F').replace(/#/g, '%23')` — which still matches what the browser sends for those characters in a path, and add a test for a file named `:id`. Alternatively, skip and warn on any scanned filename containing a pattern metacharacter.

## Revalidation

**Verdict:** true-positive

Every step checks out. publicRouteKey is bare encodeURI(urlPath) (publicDir.ts:35-37), and encodeURI by specification leaves : * ? # unescaped; publicDir.test.ts:86-90 deliberately pins that under-encoding to keep , ( ) literal, and nothing re-escapes afterwards. The result is used directly as a Bun route-pattern key at publicDir.ts:88/95, and Bun's routing docs define the pattern grammar and precedence as exact > :param > /prefix/* > global /* , so a public file named :id registers /:id — matching every single-segment URL no declared exact route claims — and one named * registers the global catch-all, which is precisely the failure staticDirs.ts:17-21 refuses a root mount to avoid ('answers every unmatched request with Bun's own 404 — shadowing the framework's error page, fetch fallback and asset routes'). The framework demonstrably knows these two characters are pattern syntax: isWarmablePattern rejects any pattern containing : or * for exactly this reason (warmup.ts:19-22). Neither guard can catch it, as claimed: the runtime check is the exact-string routeKey in routes (publicDir.ts:89), and the build-time collision check is the same exact-string comparison against both the raw and encoded form (cli/build.ts:129-135), so /:id never collides with a declared /login. Ordering is as described — user routes are registered first and public files are merged into the same bunRoutes object afterwards (Mochi.ts:1859). The security framing is the weakest part: registerPublicRoutes runs at boot and, in development only, from devWatcher.ts:737, so an upload-written filename needs a restart to take effect, and ? / # surviving merely makes a file unreachable. But the correctness defect is certain and easy to hit innocently — any ISO-8601-timestamped filename contains colons on a POSIX box — and the outcome is either a misrouted URL subtree or a boot-time pattern error. BUG is the right severity; the suggested post-encodeURI escaping of : * ? # still matches what browsers send for those characters in a path.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-19)
