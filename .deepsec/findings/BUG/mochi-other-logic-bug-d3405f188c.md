# [BUG] The drift guard aggregates matches across both globals, so a regression in __mochi_page_entry is silent

**File:** [`packages/site/src/lib/debugBarEncode.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/debugBarEncode.ts#L11-L19) (lines 11, 14, 19)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`matched` is a single counter incremented once per entry in `DEBUG_GLOBALS` that matched (line 14), and the caller only warns when it is zero: `index.ts:106` is `if (matched === 0 && html.includes('__mochi_debug'))`. With two globals a healthy page yields `matched === 2`. If the framework's emission format drifts for only one of them — say `__mochi_page_entry` moves to a different shape while `__mochi_debug` keeps the `<script>window.X=...</script>` form — `matched` is 1, the warning never fires, and that global's raw file paths go on being inlined into every production page. That is precisely the "silent no-op" the file's doc comment on line 8 and the caller's comment at index.ts:103-105 claim to prevent ("surface it loudly rather than silently regressing"). The warning's `html.includes('__mochi_debug')` precondition hard-codes the other global's name too, so it cannot detect the page-entry case even in principle. Consequence is the phantom-URL/path-disclosure regression the module exists to stop, re-entering unnoticed.

## Recommendation

Return per-global results instead of a sum — e.g. `{ html, matched: Record<string, boolean> }` or a `missed: string[]` of globals that were present in the HTML but did not match — and have `index.ts` warn naming each global that is present-but-unmatched. Extend `debugBarEncode.test.ts` with a case where one global matches and the other does not, asserting the guard fires.

## Revalidation

**Verdict:** true-positive

The logic defect is exactly as described. `DEBUG_GLOBALS` holds two names; `matched` is a single counter incremented inside each (non-global) `replace` callback, so a healthy page with both globals present yields 2, and the only consumer — index.ts:106, `if (matched === 0 && html.includes('__mochi_debug'))` — can therefore never distinguish 'both matched' from 'one matched, one drifted'. The precondition compounds it by hard-coding the *other* global's name, so the page-entry case is undetectable even in principle. I confirmed both emission sites and that the regex is coupled to them: Mochi.ts:356 emits `<script>window.__mochi_debug=…</script>` and Mochi.ts:357 emits `<script>window.__mochi_page_entry=…</script>`, whose value is `opts.pageEntry` — an absolute source path, i.e. exactly the slash-shaped string this module exists to make opaque. The existing guard test only asserts `matched >= 1` against real framework output and only asserts `window.__mochi_debug=` is present (debugBarEncode.test.ts:72-76), so nothing covers the page-entry coupling — the finding's recommendation to add per-global reporting plus a one-matches-one-doesn't test is sound. One mitigation the finding misses, which I'm recording because it bounds today's impact: Mochi.ts:357 gates `pageEntryScript` on `liveReloadClientJs`, and the deployed image sets `ENV MOCHI_LIVE_RELOAD=false` (Dockerfile:61), which index.ts:166 turns into `liveReload: false` — so `__mochi_page_entry` is not emitted in the current production deployment at all, and the guard happens to work for the one global that is. The hole becomes live the moment that env var changes (the code path fully supports live reload in dev mode), and the structural claim — the guard cannot detect a per-global regression, contrary to its own docstring — is unambiguously true. BUG severity is right.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
