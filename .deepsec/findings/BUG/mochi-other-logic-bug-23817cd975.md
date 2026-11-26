# [BUG] --sha / --latest-version filter is silently ignored by the shape-growth analysis

**File:** [`memtest/analyze.ts`](https://github.com/khromov/mochi/blob/main/memtest/analyze.ts#L174-L187) (lines 174, 179, 186, 187)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`--sha <s>` and `--latest-version` exist so a retained window spanning several daily image builds is diffed *within one code version* (documented at lines 16-19 and in memtest/README.md). `listSnapshots()` honours that filter, and `runGrowth()` uses its result for the header (`Growth analysis over ${snaps.length} snapshots`), for `newest`, and for the constructor-delta table. But the memlab half is handed the raw directory: `analysis.analyzeSnapshotsInDirectory(SNAPSHOT_DIR, { workDir: WORK_DIR })`. memlab passes that through as `snapshot-dir` and enumerates *every* `.heapsnapshot` in it (verified in @memlab/heap-analysis/dist/BaseAnalysis.js), so `ShapeUnboundGrowthAnalysis` runs across all versions regardless of the filter. Concretely: with 168 hourly snapshots spanning 7 daily SHAs, `--latest-version` prints 'Filtering to version abc1234: 24/168 snapshots' and then reports 'sustained growth' shapes computed from all 168 — i.e. cross-version shape churn presented as a leak in the current build, with a count series whose length doesn't even match the filtered set the surrounding output describes. `classifyTrend` then slices that mismatched series. The report is wrong in exactly the case the flags were added for.

## Recommendation

When a filter is active, stage the filtered snapshots into a temp directory (symlink or copy) and pass that to `analyzeSnapshotsInDirectory`, or drop to a per-file memlab API. At minimum, refuse `--growth` together with `--sha`/`--latest-version` and say why, instead of printing a filtered header over unfiltered analysis.

## Revalidation

**Verdict:** true-positive

Confirmed against memlab's installed source rather than its docs. `runGrowth()` (analyze.ts:174) gets the *filtered* list from `listSnapshots()` and uses it for the header (line 179), `newest` (178), and the constructor-delta table (211-212) — but line 186 hands memlab the raw directory: `analysis.analyzeSnapshotsInDirectory(SNAPSHOT_DIR, { workDir: WORK_DIR })`. In `node_modules/@memlab/heap-analysis/dist/BaseAnalysis.js`, `analyzeSnapshotsInDirectory` passes the argument straight through as `args['snapshot-dir']`; `ShapeUnboundGrowthAnalysis.process` calls `PluginUtils.snapshotMapReduce`, which resolves `getSnapshotDirForAnalysis(options)` → that same dir → `utils.getSnapshotFilesInDir(snapshotDir)`, which in `@memlab/core/dist/lib/Utils.js:1436-1447` is a bare `readdirSync(dir).filter(f => f.endsWith('.heapsnapshot'))`. The JSDoc is explicit: 'all snapshot files will be loaded and analyzed'. So the `--sha` / `--latest-version` filter has literally no effect on the shape analysis, while `listSnapshots()` has already printed `Filtering to version <sha>: N/M snapshots`. The result is exactly the described mismatch: a filtered header and constructor table printed over an unfiltered shape series, with `s.counts` having one entry per snapshot in the whole directory, which `classifyTrend` then midpoint-slices — so cross-version shape churn is reported as sustained growth in the current build. The flags were added (per memtest/README.md:85-89, 162-169) precisely for the multi-SHA retained window, which is the case that is now wrong. BUG is right: internal analysis tooling, no production impact, but a report that actively misleads.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-01)
