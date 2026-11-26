# [BUG] Sitemap <loc> rebasing fails to pin the origin for non-special schemes, so a <loc> can choose the URL Chrome navigates to

**File:** [`scripts/site-health.ts`](https://github.com/khromov/mochi/blob/main/scripts/site-health.ts#L185-L372) (lines 185, 190, 191, 192, 372)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-origin-pinning-bypass`

## Owners

**Suggested assignee:** `stanislav.khromov@gmail.com` _(via last-committer)_

## Finding

fetchSitemap() parses each `<loc>` and re-points it at `base` with `rebased.protocol = origin.protocol; rebased.host = origin.host` (L190-191), on the stated assumption (L186-187) that this forces every navigation onto the operator-chosen origin. Both setters are silent no-ops for a `<loc>` whose scheme is non-special: per the WHATWG URL spec the `protocol` setter returns early when the current scheme is not special and the new value is special (javascript:/data:/mailto: -> https: is rejected), and the `host` setter returns early when the URL 'has an opaque path'. `new URL('data:text/html,<script>...', base)` therefore survives rebasing byte-for-byte, is added to `urls` with no http(s) re-validation (L192 — unlike `base` itself, which is validated at L88), and is handed straight to `Page.navigate` at L372. Anyone able to influence the sitemap bytes — a compromised or forked deployment, an operator pointed at a third-party/staging origin, or a network attacker on an `http://` base, which L88 explicitly permits — thus controls the exact URL loaded, including `data:`, `javascript:` and (depending on host-setter behaviour for file URLs) `file:` schemes. That lands attacker-chosen content in a non-origin browsing context in the Chrome instance that the previous finding leaves un-sandboxed, and sidesteps the local/production separation this function exists to enforce. This is not reachable on the production path today: buildSitemapXml() (packages/site/src/lib/docs.ts:294-315) builds every <loc> by concatenating the hardcoded SITE_BASE with static in-repo doc/blog/demo slugs, so no attacker-controlled data reaches a <loc>. The defect is in the trust boundary — the script treats a network-fetched sitemap as trusted input — rather than in current content.

## Recommendation

Rebuild the URL instead of mutating it, and validate the result: `const rebased = new URL(`${loc_path}${loc_search}`, base)` using only the parsed pathname/search, or keep the current mutation and then reject anything that doesn't match — `if (rebased.origin !== origin.origin || !['http:','https:'].includes(rebased.protocol)) { warn + continue; }`. Apply the same guard in check-llms.ts's rebase().

## Revalidation

**Verdict:** true-positive

The URL mechanism is real and I verified it against the WHATWG spec, but the security impact does not hold, so this is a correctness defect, not a MEDIUM vulnerability. Mechanism: for a <loc> like 'data:text/html,<script>…', new URL(loc, base) at L185 ignores the base and yields an opaque-path URL; 'rebased.protocol = origin.protocol' (L190) is a spec-mandated no-op because scheme state with a state override returns when url's scheme is not special and the buffer is special; 'rebased.host = origin.host' (L191) is a no-op because the host setter's step 1 returns when the URL has an opaque path. The value is then added at L192 with no http(s) re-validation (unlike base itself at L88) and handed to Page.navigate at L372. So fetchSitemap() does not uphold the origin-pinning contract its own comment (L181-182) states — that part is confirmed. Why the security claim fails, on three independent legs. (1) Unreachable: I read buildSitemapXml() in packages/site/src/lib/docs.ts — every <loc> is built from the hardcoded SITE_BASE constant plus static demos[] hrefs and in-repo doc/post slugs, so no attacker-influenced bytes can reach a <loc>. (2) No privilege gain even if reachable: the precondition is an attacker who controls the sitemap bytes of the origin the operator chose, and such an attacker can already serve arbitrary HTML+JS at an ordinary https URL of that origin, which this script will navigate to and execute. data: lands in an opaque origin and javascript: executes against the preceding about:blank context (L296) — both strictly *less* privileged than a real origin. (3) The file: escalation the finding hedges on resolves against it: 'file:///etc/passwd' has an empty host and a NON-opaque path, so the host setter's opaque-path guard does not trigger and it is rewritten to 'file://mochi.fast/etc/passwd' — no local file read. The only residual is a non-special scheme without '//' reaching an external protocol handler, which headless Chrome blocks absent a user gesture. I am calling this true-positive rather than false-positive because the defect itself is genuine and the fix is worth applying for contract hygiene (and to avoid the same no-op-setter pattern being reused in product code where origin pinning does carry weight, e.g. the SSRF guard), but the severity must drop to BUG and the security impact should be withdrawn. This keeps F2 consistent with my F4 verdict on the identical mechanism in check-llms.ts.

## Recent committers (`git log`)

- Stanislav <stanislav.khromov@gmail.com> (2026-08-22)
- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
