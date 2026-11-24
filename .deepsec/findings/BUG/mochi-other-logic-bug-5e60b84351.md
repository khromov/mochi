# [BUG] Unvalidated --concurrency makes the link check pass vacuously with exit code 0

**File:** [`scripts/check-links.ts`](https://github.com/khromov/mochi/blob/main/scripts/check-links.ts#L44-L253) (lines 44, 68, 157, 205, 253)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`--concurrency` is parsed with a bare `concurrency = Number(next)` (L44) and never validated, unlike the two sibling crawlers which both reject it (`!Number.isFinite(concurrency) || concurrency < 1` — site-health.ts L79-82, check-llms.ts L52-55). pool() sizes its worker set with `Array.from({ length: Math.min(limit, items.length) }, …)` (L68); `Math.min(NaN, n)` is NaN and ToLength(NaN) is 0, so a non-numeric value (`--concurrency abc`, `--concurrency ''`) or a literal `0` or negative value produces an empty worker array, `Promise.all([])` resolves instantly, and the pool body never runs. Both pools are affected: the crawl pool (L157) extracts no links and records no page errors, and the check pool (L205) checks nothing. `failed` is then 0, so the script prints `✓ All 0 links OK across N pages.` and exits 0 (L253-255) while having verified nothing. A typo'd or templated flag value therefore converts this from a link check into a guaranteed green, with output that looks like a successful run rather than an error.

## Recommendation

Validate after parsing, mirroring the sibling scripts: `if (!Number.isFinite(concurrency) || concurrency < 1) { console.error('--concurrency must be a positive number'); process.exit(2); }`. Additionally harden pool() itself — e.g. `const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))` — so no caller can silently reduce it to zero.

## Revalidation

**Verdict:** true-positive

Confirmed end-to-end, and the strongest finding in this batch. L39-44 parses --concurrency with a bare Number(next) and parseArgs returns it (L52-56) with no validation — I verified the contrast the finding draws: site-health.ts L79-82 and check-llms.ts L52-55 both reject '!Number.isFinite(concurrency) || concurrency < 1', so this is an inconsistency rather than a deliberate omission. pool() at L68 sizes workers with Array.from({ length: Math.min(limit, items.length) }); Math.min(NaN, n) is NaN and Array.from's array-like path runs LengthOfArrayLike → ToLength(NaN) → 0, so a non-numeric value yields an empty worker array and Promise.all([]) resolves instantly. Math.min(0, n) = 0 and Math.min(-1, n) = -1 → ToLength = 0 give the same result. Both call sites take concurrency directly (crawl at L157, link check at L205), so with `--concurrency abc` (or 0, or -1): no page is fetched, so `links` and `pageErrors` stay empty; `targets` is empty so the second pool does nothing; broken/trailingRedirects stay empty; `failed` is 0 at L252; and L253-255 prints '✓ All 0 links OK across N pages.' and exits 0. Because `pages.length` is non-zero, the success line reads as though real work happened. Two minor corrections to the write-up, neither affecting the verdict: `--concurrency ''` is actually caught — an empty string is falsy, so the `if (!next)` guard at L41 exits 2 — and the script is not in CI (I grepped .github/ and the only reference anywhere is the package.json L48 alias), so the impact is a developer-run check that reports success while verifying nothing, rather than a guaranteed-green CI gate. Both recommended fixes are right; hardening pool() itself is the more durable of the two since all three scripts share that helper.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-06-29)
