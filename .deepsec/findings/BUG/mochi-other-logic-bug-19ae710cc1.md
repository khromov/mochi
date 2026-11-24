# [BUG] rebase() can return a non-http(s) URL, crashing the run with an unhandled rejection instead of skipping the entry

**File:** [`scripts/check-llms.ts`](https://github.com/khromov/mochi/blob/main/scripts/check-llms.ts#L85-L360) (lines 85, 92, 93, 94, 146, 164, 191, 360)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

rebase() (L85-96) re-points a URL at `base` by assigning `u.protocol` and `u.host`, and its only failure mode is the try/catch around `new URL()` returning null. For a non-special scheme both setters are spec-mandated no-ops (protocol: non-special -> special is rejected; host: returns early when the URL has an opaque path), so a `<loc>` such as `javascript:x` or `data:text/plain,x` is returned unchanged and pushed into `pages` (L164-169) as if it had been rebased — the `Skipping unparseable <loc>` branch never fires. Downstream, expectedForPage() calls `new URL(`${withSlash}llms.txt`, pageUrl)` (L146) with an opaque-path base, which throws a TypeError; `main()` is invoked without a `.catch()` (L360), so the script dies with an unhandled rejection rather than reporting a finding. The same unpinned rebase is applied to `entry.url` values taken from the site's own /llms.json response (L191), which the script's own comments acknowledge may report a different origin than `base`; those rebased URLs are then fetched directly at L244. Not currently reachable in production (the sitemap is generated from static in-repo slugs), but the function does not uphold the contract its docstring states.

## Recommendation

Have rebase() return null unless the rebased URL's origin matches `new URL(base).origin` and its protocol is http(s) — then the existing 'Skipping unparseable <loc>' path handles it. Also attach a `.catch()` to `main()` so an unexpected throw exits 2 with a readable message, matching site-health.ts (L515-518).

## Revalidation

**Verdict:** true-positive

Verified, including the throw, which I traced through the URL spec rather than assuming. rebase() (L85-96) assigns u.protocol and u.host; as established in F2 both are spec no-ops for an opaque-path URL, so a non-special-scheme <loc> is returned unchanged and pushed into `pages` at L169 — the 'Skipping unparseable <loc>' branch never fires, exactly as claimed, and the docstring at L84 ('Re-point an absolute URL … at base') is therefore false for that input. Downstream, expectedForPage() L146 evaluates new URL(`${withSlash}llms.txt`, pageUrl) with pageUrl = 'data:text/html,x'. This does throw: the parser finds no valid scheme in the relative input, restarts in no-scheme state, and that state returns failure when base has an opaque path and the first code point is not '#' — so new URL raises a TypeError, which is not caught, and main() is invoked bare at L360 (no .catch()), unlike site-health.ts L515-518 which does wrap it. The result is a raw unhandled rejection instead of a reported finding. On reachability I reached the same conclusion as for F2 — buildSitemapXml() emits only hardcoded-origin https URLs, so the sitemap trigger cannot occur today, and the finding honestly says so. What makes this a true positive rather than a purely hypothetical note is that the second half of its recommendation is independently reachable: L184 does JSON.parse(await fetchText(`${base}/llms.json`)) and fetchText only exits on !res.ok, so a 200 carrying an HTML error body — precisely the failure mode this script checks for at L270-273 — makes JSON.parse throw and kills the run with an unhandled rejection and a raw stack instead of a clean exit 2. That is a plausible dev-server/proxy misconfiguration, not an attacker scenario. So: no security impact (hence BUG, matching the assigned severity), but a verified contract violation plus a verified and reachable missing-error-handler gap, both worth fixing as recommended.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-26)
