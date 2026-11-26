# [MEDIUM] JSON object keys are emitted unescaped into HTML, giving DOM XSS at the debug bar's {@html} sinks

**File:** [`packages/mochi/src/vendor/json-format-highlight/index.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/vendor/json-format-highlight/index.ts#L36-L51) (lines 36, 41, 51)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `xss`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`formatHighlight()` claims to sanitize its output (both consumers carry `eslint-disable-next-line svelte/no-at-html-tags -- sanitized JSON highlight output`), but it escapes only JSON string *values*, never *keys*.

Two defects combine:

1. **Line 36 is a no-op.** `str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')` replaces each character with itself. This was intended to be the classic `&amp;`/`&lt;`/`&gt;` escape pass (the `entityMap` at L11-19 shows the author's intent) and is faithfully carried over from upstream 1.0.4, so there is no global escaping at all.
2. **The key branch never escapes.** At L40-47, a match starting with `"` is split: when it ends with `:` (a key) only `color = colors.keyColor` is assigned and `match` passes through raw; the value branch at L45 is the only path that calls `escapeHtml(...)`. `match` is then interpolated into HTML at L51.

`JSON.stringify` does not escape `<`, `>` or `&`, so a key like `<img src=x onerror=alert(1)>` survives L31 intact, matches the regex at L37 as `"<img src=x onerror=alert(1)>":`, and is returned as `<span style="color:#b8d5be">"<img src=x onerror=alert(1)>":</span>`.

**Reachability.** Both call sites render this through `{@html}`:
- `packages/mochi/src/debug-bar/IslandRow.svelte:42` — `formatHighlight(rest, …)` where `rest` is `JSON.parse(window.__mochi_debug.serverProps[token])`, i.e. an app's decoded server-island props; and L55 — `formatHighlight(devalueParse(island.rawProps), …)`, the client island's props read back out of the page. Rendered at L115.
- `packages/mochi/src/debug-bar/ImageRow.svelte:28` — `formatHighlight(image.params, …)`, rendered at L64. Note this `{@html}` is always in the DOM (`.image-detail` is merely `display:none` when collapsed), so an injected `<img onerror>` fires without any click; `IslandRow` needs the row expanded.

The SSR seeding is correctly escaped (`jsonForHtml` in `Mochi.ts:175` does `.replace(/</g, '\\u003c')`), so the raw `<` is reconstituted only client-side — the injection is purely in this function.

**Attack scenario.** Any Mochi app that gives an island a props object keyed by untrusted data — form-error maps keyed by field name, tag/slug counters, header or query-param records, DB rows keyed by user-supplied strings — lets an attacker who controls one of those keys plant `<img src=x onerror=…>` in the page. A developer running the dev server and expanding that island row in the debug bar executes the attacker's JS on the dev origin, where dev-only routes reachable same-origin include the page-cache admin, client-stats (bundle inputs and filesystem paths) and the email viewer (arbitrary attachment bytes).

**Why MEDIUM, not HIGH.** The sinks exist only when `debugBarEnabled` (`Mochi.ts:503`: `development && (options.debugBar ?? true)`), so this is a dev-tooling XSS requiring developer interaction for the island path, not an internet-facing one — unless an app deploys with `development: true`.

A secondary, currently-unexploitable hole in the same expression: `colorOptions` values are interpolated into the `style="…"` attribute at L51 with no escaping, so a color string containing `"` would break out of the attribute. Both consumers pass hardcoded constants, so it is not reachable today.

## Recommendation

Escape the key branch and repair the dead escape pass. The safest shape is to stop relying on the per-match escaping entirely: escape every `match` unconditionally before it is interpolated at L51, rather than only in the value branch at L45. Concretely, in the key branch at L41-42 add the same treatment the value branch already uses — strip the quotes and trailing colon, run the key through `escapeHtml()`, then reassemble — so that `color = colors.keyColor` is no longer the only thing that happens to a key.

Alternatively, fix line 36 to actually escape (`str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')`) and drop the per-match `escapeHtml` at L45; if you take that route you must also widen the regex's `[^\\"]` character class so it still matches correctly over `&amp;`-style entity sequences, otherwise highlighting silently breaks on any string containing `&`, `<` or `>`.

Also run `colorOptions` values through `escapeHtmlAttr()` (or validate them against a CSS-color allowlist) before the `style="…"` interpolation at L51 to close the latent attribute-breakout.

Finally, correct or remove the `-- sanitized JSON highlight output` justification on the two `eslint-disable` comments in `IslandRow.svelte:114` and `ImageRow.svelte:63`, and add a regression test asserting that `formatHighlight({'<img src=x>': 1})` contains no raw `<img`, plus cases for keys and values containing `<`, `>`, `&`, `"` and `</pre>`.

## Revalidation

**Verdict:** true-positive

I confirmed both defects at the byte level. `od -c` on line 36 shows literally `str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')` — each character replaced by itself, a faithful carry-over of upstream 1.0.4's broken escape pass, so there is no global escaping at all (the unused `entityMap` at L11-19 shows the intent). The per-match branch then escapes only *values*: at L40-47 a match starting with `"` and ending with `:` is a key and gets nothing but `color = colors.keyColor`, while only the value branch at L45 calls `escapeHtml`; `match` is interpolated raw at L51. `JSON.stringify` does not escape `<`, `>` or `&`, and the regex's `[^\\"]` class happily spans `<img src=x onerror=alert(1)>`, so that key survives L31/L37 intact and is emitted inside a `<span>`. I traced the full client-side chain for the exploitable sink, `IslandRow.svelte`: for server islands, `serverIslandCrypto.ts:38` records `JSON.stringify(devalParse(propsJson), jsonSafeReplacer, 2)`; `Mochi.ts:175`'s `jsonForHtml` escapes `<` to `\u003c` only for the HTML-parsing layer, so after JS parsing the string holds a real `<`, and `JSON.parse(recorded)` at IslandRow.svelte:40 restores the raw key before `formatHighlight(rest)` at L42 is rendered through `{@html}` at L115. The client-island path (`devalueParse(island.rawProps)` at L55, with `rawProps` read from the island's `<script>` textContent or `props` attribute in IslandsPanel.svelte:76-85) has the same shape. `{@html}` sets innerHTML, so an injected `<img onerror>` fires. One correction to the finding: `ImageRow.svelte` is *not* exploitable — `image.params` keys are hardcoded by `imageApi.ts:223,242` (`src`/`width`/`height`/`format`/`quality`/`original`) and every string value goes through the escaping branch, so its always-in-DOM `{@html}` has no injection vector; the attack requires an island whose props carry an attacker-controlled object key (a form-error map keyed by field name, a tag/slug counter, a DB row keyed by user text) plus a developer expanding that row. Reachability is correctly bounded to dev: `Mochi.ts:503` gates on `development && (options.debugBar ?? true)` and `utils/env.ts:13` derives dev from `NODE_ENV === 'development'` exactly, so an unset NODE_ENV fails safe — MEDIUM is right. On the project's 'known false-positives' note that `packages/mochi/src/vendor/` is out of scope: that exemption's stated rationale is 'fixtures, tests, build output, or vendored code', and it does not hold here — this file is first-party-maintained TypeScript (commit 0b883994) that is compiled and shipped into the debug-bar bundle, and the harm lands in first-party consumers whose `eslint-disable … -- sanitized JSON highlight output` justifications at IslandRow.svelte:114 and ImageRow.svelte:63 are factually false. The latent `colorOptions`-into-`style=""` breakout at L51 is correctly flagged as unreachable today (both callers pass hardcoded constants).

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-28)
