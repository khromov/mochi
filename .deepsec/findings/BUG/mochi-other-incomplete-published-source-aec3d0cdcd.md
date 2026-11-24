# [BUG] Published demo source omits shared.ts, leaving parseTransition/TRANSITIONS undefined and a dangling './shared' import

**File:** [`packages/site/src/demos/view-transitions/files.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/view-transitions/files.ts#L3-L6) (lines 3, 6)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-incomplete-published-source`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The demo's `files` list is the single source of truth for the source tabs rendered by `loadSources(files)` and for `/demos/view-transitions/llms.txt` (built from the same list via `filesForDemo(slug)` in `lib/docs.ts:213`), which also backs the public `/mcp` `get_section` tool. `shared.ts` is not in the list, but it defines three symbols the published files actually use, and the result is broken two different ways:

1. `TransitionCard.svelte` (published at L6) keeps `import { TRANSITIONS, type TransitionType } from './shared';` verbatim — `stripDemoWrapper` (components/utils.ts:74) returns early for it because it has no `import DemoPage from` line. So the published set contains an import of a file that appears in no tab and in no llms.txt section.

2. `PageOne.svelte`/`PageTwo.svelte` (L4-L5) import `{ description, sources, parseTransition }` from `./shared`, and `stripDemoWrapper`'s regex at components/utils.ts:83 deletes that entire import line. But unlike the sibling demo, this one pulls a *real demo API* through that import: the surviving body still calls `const type = parseTransition(url.searchParams.get('type'));`, so the published source calls a function that is neither imported nor defined anywhere in the published set.

The byte-identical sibling demo is the control: `custom-transitions/` has the same PageOne/PageTwo/shared.ts/sources.prerender.ts structure (all 60 demos' `sources.prerender.ts` are md5-identical) and its `files.ts:7` *does* publish `{ label: 'shared.ts', path: './src/demos/custom-transitions/shared.ts' }` — and its PageOne imports only `{ description, sources }`, i.e. pure plumbing, so stripping that line leaves compilable code. Note this is specific to `./shared`: the `../../components/ViewTransitionFirefoxNote.svelte` import is unpublished in both demos, so that one is an accepted convention for site chrome.

Not a security issue — the omitted file contains no secrets and the paths are static literals, so there is no traversal or disclosure. The impact is that the demo's published source cannot be copy-pasted and run, and that an LLM consuming `/demos/view-transitions/llms.txt` or the `/mcp` demo section is handed code referencing an undefined `parseTransition`. `lib/demoRegistry.test.ts` only asserts that a `files.ts` exists and is registered — it never checks that the declared set is self-contained, so nothing catches this.

## Recommendation

Add `{ label: 'shared.ts', path: './src/demos/view-transitions/shared.ts' }` to the list, matching `custom-transitions/files.ts:7`. That fixes the dangling import in TransitionCard.svelte, but not PageOne/PageTwo: because `stripDemoWrapper` unconditionally strips the `./shared` import, `parseTransition` would still be called with no visible import. Either narrow that regex in `components/utils.ts:83` so it only drops the plumbing specifiers (`description`, `sources`) and keeps the rest of the named imports, or move `parseTransition`/`TRANSITIONS` out of `shared.ts` into a published module that PageOne/PageTwo import under a different path. Consider extending `demoRegistry.test.ts` with a check that every relative import inside a published source resolves to another published path (allowlisting `../../components/`), which would have caught this automatically.

## Revalidation

**Verdict:** true-positive

Confirmed on both halves, by reading the full chain rather than the flagged lines. `view-transitions/files.ts` lists PageOne, PageTwo, TransitionCard, PersistentVideo, persistent.js, routes.ts and demoIndex.ts — no `shared.ts` — while `view-transitions/shared.ts` exports `TRANSITIONS`, `TransitionType`, `parseTransition`, `description` and a re-exported `sources`. That list is the single source of truth for both consumers: `sources.prerender.ts` calls `loadSources(files)`, which runs each file through `stripDemoWrapper` (`components/utils.ts:23,73`), and `lib/docs.ts:213` (`buildDemoLlmsTxt` via `filesForDemo`, `docs.ts:25`) builds `/demos/view-transitions/llms.txt`, which also backs the public `/mcp` `get_section` tool (`lib/mcp.ts:57`). Half 1: `TransitionCard.svelte` has no `import DemoPage from` line, so `stripDemoWrapper` returns early at `utils.ts:74-76` and the tab is published verbatim with `import { TRANSITIONS, type TransitionType } from './shared';` pointing at a file that appears in no tab and no llms.txt section. Half 2: PageOne/PageTwo do have the `DemoPage` import, so the regex at `utils.ts:83` deletes the whole `import { description, sources, parseTransition } from './shared';` line (I hand-traced the regex: `[^}]*` cannot cross a `}`, so it matches only the `./shared` line, not the earlier braced imports), while `utils.ts:84` strips the `<DemoPage …>` wrapper and its `{description}`/`{sources}` attributes — leaving `const type = parseTransition(url.searchParams.get('type'));` in the published script with no import and no definition anywhere in the set. The sibling control checks out exactly as described: `custom-transitions/files.ts:7` does publish `shared.ts`, and its PageOne imports only `{ description, sources }`, so stripping that line leaves compilable code. The `../../components/ViewTransitionFirefoxNote.svelte` import is indeed unpublished in both demos (TransitionCard.svelte:3 and SpinCard.svelte:2), so that one is a consistent site-chrome convention, not the defect. `lib/demoRegistry.test.ts` only asserts slug/files presence and folder registration — nothing checks self-containment, so nothing catches this. One nuance the finding slightly overstates: `buildDemoLlmsTxt` reads raw file text and never calls `stripDemoWrapper`, so llms.txt/`/mcp` consumers see PageOne *with* its `./shared` import but without the module it names — an unresolvable import rather than a literally undefined symbol; the on-page source tabs are where `parseTransition` is called with no visible import. Correctly non-security (static literal paths, no secrets in the omitted file, and `loadSources` only reads paths declared in the registry). The author's `shared.ts` comment says the file is meant to be hidden, so the right fix may be to move the real API (`parseTransition`/`TRANSITIONS`) out of the plumbing module rather than simply publishing it — but either way the published set is objectively not self-contained, so BUG stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-26)
