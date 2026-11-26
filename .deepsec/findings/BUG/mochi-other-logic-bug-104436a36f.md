# [BUG] Subsetting silently deletes an @font-face when its unicode-range list is not in ascending order

**File:** [`packages/mochi/src/compiler/fontSubset.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/fontSubset.ts#L63-L66) (lines 63, 64, 66)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`intersectRanges()` (fontImportAttributes.ts:189) is a two-pointer sorted-merge intersection: it advances `i` or `j` based on which range ends first, which is only correct when BOTH inputs are sorted by `lo` and disjoint. `group.ranges` satisfies that (textToRanges -> mergeRanges), but `faceRanges` on line 63 comes straight from `parseCss()` -> `readUnicodeRanges()` (cssAst.ts:164), which preserves CSS source order and never sorts or merges. Nothing between the parse and the call normalises it — fontSubset.ts:64 is the only non-test caller of `intersectRanges`, and the sibling dev-check path (`rangesByFamily`) does call `mergeRanges` first, so the omission here is an inconsistency rather than a deliberate invariant.

With an out-of-order list the intersection under-reports or comes back empty. Empty means line 66 removes the entire `@font-face` block from the shipped stylesheet and only increments `droppedFaces`, which is never logged anywhere (ComponentRegistry.ts:2272-2298 logs `variants` only, and a `droppedFaces > 0` run still sets `subsetOutcome = 'applied'`, suppressing the 'nothing could be subsetted' warning). The build stays green and silent while the font disappears from the page. A partial under-report is worse: the face survives but its subset is built from too few codepoints, so glyphs the developer asked for are missing from the font file.

Every existing test (fontSubset.test.ts:17, 95; cssFontSubset.test.ts:21, 29) uses ascending ranges, as do @fontsource and Google Fonts output, so the defect is invisible to the suite and to the common case.

## Recommendation

Normalise the face ranges before intersecting: `const faceRanges = face.unicodeRanges ? mergeRanges(face.unicodeRanges) : ALL_CODEPOINTS;` (mergeRanges already sorts and coalesces, and is exported from the same module). Either that, or sort inside `readUnicodeRanges()` so every consumer gets the invariant `intersectRanges` assumes. Separately, log or warn on `droppedFaces > 0` so a removed @font-face is never silent, and add a regression test with a descending list such as `unicode-range: U+2000-206F, U+0020-007F`.

## Revalidation

**Verdict:** true-positive

Verified by tracing both inputs to `intersectRanges` and every consumer of the result. `intersectRanges` (fontImportAttributes.ts:189-206) is the textbook two-pointer interval-list intersection: it advances `i` or `j` purely on `a[i].hi < b[j].hi`, which is only correct when both lists are sorted by `lo`. Input `a` (`group.ranges`) is guaranteed sorted and disjoint — `mergeFontSubsetSpecs` → `textToRanges` → `mergeRanges` (which `toSorted`s and coalesces), and the `FontSubsetGroup.ranges` doc comment says so. Input `b` (`faceRanges`, fontSubset.ts:63) comes straight from `parseCss` → `readFontFace` → `readUnicodeRanges` (cssAst.ts:164-169), which is a bare `filter().map().filter()` over `value.children` — it preserves CSS source order and never sorts or merges. I grepped every `unicodeRanges` reference in the package: the only other consumer is `cssFontAssets.ts:186`, which uses order-independent `.some()`, and the sibling dev-check path `rangesByFamily` (fontImportAttributes.ts:248-259) *does* call `mergeRanges` first — so the omission at fontSubset.ts:64 is an inconsistency, not an invariant held elsewhere. I hand-traced the stated counterexample: with `a = [{0x41,0x41}]` and `b = [{0x2000,0x206F},{0x20,0x7F}]`, the first iteration computes lo=0x2000 > hi=0x41 (no push), then `a[0].hi < b[0].hi` advances `i` past the end — result `[]`. `kept.length === 0` then hits fontSubset.ts:65-68, which `edits.remove(face.start, face.end)`s the whole `@font-face` and only bumps `droppedFaces`. The silence is confirmed at ComponentRegistry.ts:2272-2303: the per-variant `logger.info` loop never fires (no variants), `droppedFaces > 0` sets `subsetOutcome = 'applied'` (line 2289-2291), which suppresses the only warning (line 2299), and `droppedFaces` is logged nowhere — so the build stays green while the font vanishes from the page. Partial under-reporting is the worse sibling case: the face survives with a subset built from too few codepoints. The CSS spec places no ordering requirement on `unicode-range`, so this is legal input; it is invisible to the suite because every fixture is ascending (fontSubset.test.ts:17 `U+0000-00FF,U+0131,U+0152-0153`; :95 `U+0400-045F`; cssFontSubset.test.ts:21,29), as is @fontsource/Google Fonts output. That makes it a genuine latent bug with an unusual-but-legal trigger — BUG is correct. The proposed fix is sound: `mergeRanges` copies (`merged.push({...range})`) so it won't mutate the parsed AST.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
