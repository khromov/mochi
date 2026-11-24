# [MEDIUM] pinGlobal state keys are DOM-clobberable, letting injected markup disable island hydration and amplify island-endpoint requests

**File:** [`packages/mochi/src/web-components/sharedCssTracker.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/web-components/sharedCssTracker.ts#L7) (lines 7)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-dom-clobbering`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The tracker pins its state with `pinGlobal<Set<string>>('__mochi_loaded_css__', ...)`, and pinGlobal (utils/globalState.ts:6-8) initialises with `slot[key] ??= factory()` and no type check. In a browser realm `slot` is `window`, whose named-properties object exposes every element with a non-empty `id` (and `name`, for img/form/object/embed) as a window property. Because island bundles are deferred module scripts that run after the document is parsed, the clobbered property already exists when `??=` reads it; an Element is not null/undefined, so the factory never runs and `pool` is an HTMLElement.

Attack: inject `<p id="__mochi_loaded_css__">` into any user-controlled HTML region. DOMPurify's default configuration allows `id`, as do most markdown renderers that emit heading anchors, so this survives sanitization that successfully strips scripts, event handlers and javascript: URLs — i.e. it is reachable precisely where plain XSS is not. Effects:

- `isLoadedCss()` → `pool.has is not a function` → thrown inside `_doHydrateInner`, caught at HydratableIsland.ts:58, so every island with a `css-url` (all `mochi:hydrate:visible` and `mochi:clientOnly:visible` islands) renders the failure stub and never becomes interactive.
- ServerIsland.ts:9 resolves the same key at module scope, and the `_css.has(cssUrl)` call sits inside `_fetchContent`'s try block (ServerIsland.ts:160-219), so the TypeError is swallowed by the retry loop: every server island on the page re-fetches `/_mochi/island/<name>` 11 times over ~30s before giving up and showing its fallback forever. That is a ~11x request amplification against an endpoint that does AES-SIV decryption plus a full SSR render per call.

Same root cause applies to `__mochi_visibility_pool__` (sharedVisibilityObserver.ts:19 — `pool.get` throws in connectedCallback, which is uncaught and leaves no failure stub) and to `__mochi_deferred_islands__` / `__mochi_deferred_island_listeners__` in islands/deferInvalidation.ts. Impact is availability/abuse rather than confidentiality, hence MEDIUM.

## Recommendation

Harden pinGlobal against clobbering: validate the pinned value before reusing it (e.g. `const existing = slot[key]; if (!isExpected(existing)) slot[key] = factory();`), or key the slot on a `Symbol.for('mochi.loadedCss')` — symbol-keyed properties cannot be created by DOM named access. A cheap intermediate fix is a shape check at each use site (`pool instanceof Set`). Apply the same treatment to __mochi_visibility_pool__ and the deferInvalidation pins, and move the duplicated inline global access in ServerIsland.ts:9 onto the shared helper so the fix lands in one place.

## Revalidation

**Verdict:** uncertain

The clobbering mechanism is confirmed and deterministic. `pinGlobal` does `slot[key] ??= factory()` with `slot = globalThis` and no type check (utils/globalState.ts:5-9); in a browser realm the Window named-properties object exposes every element with a non-empty `id` as a window property, so if `<p id="__mochi_loaded_css__">` exists the read returns an Element, `??=` skips the assignment, and `pool` is an HTMLElement. Ordering works out: the shell puts all scripts after `{{mochi.body}}` (templates/default-shell.html), the island bundle is a deferred `type="module"` script (Mochi.ts:367) and even the inline classic ServerIsland script (368) runs after the body is parsed, so the clobbered property already exists. The downstream effects are as described: `isLoadedCss` throws a TypeError inside `_doHydrateInner`, caught at HydratableIsland.ts:58 so every `css-url`-bearing island renders the failure stub; ServerIsland.ts:9 duplicates the same global access inline and its `_css.has(cssUrl)` sits *after* the fetch inside the try block, so each of the 10 attempts (`maxRetries` 9 → `attempt <= 10`, ~27s of backoff — the finding's '11 times over ~30s' is marginally overstated) performs a real island-endpoint request before throwing. `__mochi_visibility_pool__` (sharedVisibilityObserver.ts:19, called uncaught from `connectedCallback`) and the two `deferInvalidation.ts` pins (13, 38) share the root cause. What I cannot establish is reachability: the precondition is identical to F3's — attacker-influenced `id` in rendered HTML — and no such path exists in this repo (the HN sanitizer strips all attributes; `rehype-slug` runs only on repo-authored markdown; no request data reaches an `id`). Impact is availability/request-amplification against the victim's own page, and in the DOMPurify-default scenario that makes it reachable, an `<img src>` loop would already give an injector comparable amplification. Genuine, cheap hardening (symbol key or an `instanceof Set` check), but not a confirmed vulnerability; severity left as reported rather than endorsed.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
