# [BUG] Health report is written only after every page completes, so the 20-minute job cap discards it in exactly the outage it exists to report

**File:** [`.github/workflows/site-health.yml`](https://github.com/khromov/mochi/blob/main/.github/workflows/site-health.yml#L19-L49) (lines 19, 44, 49)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`scripts/site-health.ts` accumulates results in memory and writes REPORT.md in a single `Bun.write` after the whole pool drains (site-health.ts:496), with no incremental flush. The job caps at `timeout-minutes: 20` (line 19). The worst-case runtime is far above that: the site's sitemap covers on the order of 130+ URLs (63 docs pages plus ~61 demos plus marketing/blog routes), the per-page load budget is 60s with `LOAD_ATTEMPTS = 2` (so up to 120s per hung page) and `concurrency` defaults to 4 — i.e. ~65 minutes if the origin is up but hanging, and the 20-minute cap is exceeded once roughly 40 pages hang. That is precisely the systemic-regression scenario the check exists to catch (origin reachable, so `fetchSitemap` does not short-circuit to exit 2, but SSR or an island stalls). When the cap fires GitHub cancels the job, REPORT.md does not yet exist, and both `if: always()` steps degrade to 'No report file found.' plus an empty-artifact warning — the diagnostic is lost and the only surviving evidence is the raw step log. The same single-write behavior means any mid-run crash in `checkPage`/`pool` (which `main()` turns into a bare `exit 2`) also discards all results collected so far.

## Recommendation

Make the report survivable: write/append REPORT.md incrementally as each page finishes (or install a `process.on('SIGTERM')` flush) in scripts/site-health.ts, and raise `timeout-minutes` above the script's own worst case — or bound the script with a global wall-clock budget below the job cap so it always reaches its own report-writing path.

## Revalidation

**Verdict:** true-positive

Every mechanical claim checks out against scripts/site-health.ts. There is exactly one `Bun.write(report, …)` at line 496, after `pool` fully drains, with no incremental flush and no signal handler; `main().catch` (515-518) exits 2 before that write, so any mid-run throw discards all results — and `new Bun.WebView(...)` at 284 sits outside `checkPage`'s try block, so a Chrome spawn failure partway through propagates out and loses everything. The arithmetic also holds: `timeout` defaults to 60_000 (51-52), `LOAD_ATTEMPTS = 2` (133) and `SETTLE_MS = 1500` (130) give ~121.5 s per hung page, `concurrency` defaults to 4 (51), and the workflow passes no overrides (`bun run check-site "$BASE"`, line 44). I verified the page-count basis in packages/site/src/lib/docs.ts:294-316: the sitemap emits `/` plus 63 docs plus the changelog plus `/blog/` plus posts plus ~61 internal demos, so ~130 URLs → ~66 min worst case against `timeout-minutes: 20` (line 19), with the cap crossed around 40 hanging pages; the job timeout also covers install and Chrome setup, leaving the script ~18 min. The scenario is correctly scoped — a down origin short-circuits in `fetchSitemap` with exit 2 (also no report), and a handful of hanging pages still finishes inside the cap, so the loss window is specifically the systemic SSR/island hang. One nuance the finding understates in its own favour: on a `timeout-minutes` cancellation the `if: always()` steps may not run at all, so there may not even be a 'No report file found.' summary. Mitigating context that keeps this at BUG: the per-page pass/fail lines are printed as they complete (line 488), so the raw step log survives, and the job still goes red — this is observability loss, not a missed alert.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
