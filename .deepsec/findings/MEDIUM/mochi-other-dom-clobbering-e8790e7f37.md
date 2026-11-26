# [MEDIUM] Island props taken from any DOM element matching a predictable global id

**File:** [`packages/mochi/src/web-components/resolveIslandProps.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/resolveIslandProps.ts#L12) (lines 12)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-dom-clobbering`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The props payload for a trusted island is read as `block?.textContent` from whatever element happens to answer `document.getElementById('mochi-props-N')` — there is no check that the node is the framework's own `<script type="application/json">`, no `data-` marker, and no integrity binding between the island and its payload. The ids are fully predictable (`mochi-props-0`, `-1`, … in render order).

Any element whose `id` an attacker can influence, appearing earlier in tree order than the real block, therefore supplies that island's props. Reachable paths in app code include user-authored markdown rendered with `rehype-slug` (an officially supported markdown plugin per types.ts:423) and sanitized user HTML that preserves `id` attributes. Because the props drive the client-side render, this is a trust-boundary violation: the attacker moves from "inject inert content" to "control the inputs of a first-party island", which escalates to XSS in any island that renders a prop through `{@html}` and to logic abuse elsewhere.

Exploitation needs `textContent` that parses as devalue, so a slugified heading yields only a denial of service (the island dies as a hidden failure stub); attacker-controlled sanitized HTML that keeps `id` yields full props control. Hence MEDIUM rather than HIGH.

## Recommendation

Verify the resolved node before trusting it: require `block instanceof HTMLScriptElement && block.type === 'application/json'`, and prefer an attribute-based selector the framework owns (e.g. `script[type="application/json"][data-mochi-props="<ref>"]`) over `id`, which shares a single global namespace with all page content. Combine with the id namespacing in the previous finding so refs are unguessable per render.

## Revalidation

**Verdict:** uncertain

The code claim is accurate and I confirmed it: `resolveIslandProps` takes `block?.textContent` from whatever node answers `document.getElementById('mochi-props-N')` (or `scope.querySelector('#…')`), with no check that the node is the framework's own `<script type="application/json">`, no `data-` marker and no binding between island and payload, and the ids are fully predictable because `emitIslandProps` numbers them from the per-request map size. Window/document id lookup is tree-order, so an injected element with that id placed above the real block does supply the props, and `devalueParse` on non-devalue text throws into `_doHydrate`'s catch (a hidden failure stub, i.e. a per-island DoS) while a crafted devalue payload yields full props control. What I cannot confirm is reachability. There is no path in this repository where a request-controlled value becomes an element `id`: the only `id={…}` interpolations are `EmailViewer/EmailList.svelte:16` (framework-generated outbox ids, dev-only) and a demo's Pokémon id; the only user-content HTML sink is the HN demo, and `packages/demos/src/hn/hn-sanitize.ts` is a strict allowlist (p/a/i/b/code/pre) that deletes every attribute except a URL-parsed `href`, so no `id` survives; and `rehype-slug` is applied only to repo-authored docs/mdsvex markdown, not to user submissions. So exploitability rests entirely on a downstream consumer rendering user HTML through a sanitizer that preserves `id` (DOMPurify's default does) with an island above which that content sits, and ideally a prop that reaches `{@html}` — plausible, but unverifiable from this repo. I deliberately did not mark this a duplicate of F2 even though it is the same line: the two defects are independent, since namespacing the server-island ids would not add node verification, and requiring `HTMLScriptElement && type === 'application/json'` would not help F2 (the colliding server-island block passes that test). Treat it as worthwhile hardening (attribute-based selector the framework owns) rather than a confirmed vulnerability; I left the severity as reported rather than confirm it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-28)
