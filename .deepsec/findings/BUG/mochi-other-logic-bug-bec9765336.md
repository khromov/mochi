# [BUG] First-occurrence String.replace on fully-rendered HTML lets page content hijack the analytics injection point

**File:** [`packages/shared/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/shared/src/index.ts#L27) (lines 27)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`transformPage` receives the complete response body, not the pre-substitution shell. `packages/mochi/src/runtime/hooks.ts:170-183` (`applyResolveOptions`) calls `await result.text()` on the finished Response and passes that to `opts.transformPage`, so `{{mochi.body}}` has already been replaced with rendered component output by the time this line runs.

`html.replace('{{mochi.analytics}}', …)` with a string pattern replaces only the **first** occurrence. Both shells place the placeholder at the very end of `<body>` (`packages/site/src/shell.html:415`, `packages/support/src/shell.html:123`), i.e. after all page content — so any earlier occurrence in rendered content wins.

That is reachable with attacker-supplied data. An unauthenticated visitor submits a support message containing the literal `{{mochi.analytics}}`; it is stored by the `send` action (`packages/support/src/routes.ts`) and rendered on the admin page at `packages/support/src/admin/SubmissionCard.svelte:23` as `<p class="message">{submission.message}</p>`. Svelte escapes the interpolation, but the placeholder contains no characters that HTML-escaping alters, so it reaches `transformPage` byte-identical. The tracker `<script>` is then injected into the message paragraph and the real placeholder at the end of `<body>` is left as literal visible text.

This is not XSS as written: the replacement is a fixed trusted string, and it happens to contain no `"` character, so it cannot break out of a double-quoted attribute if the reflected placeholder sits in one. That is a fragile accident, not a control — the same primitive is documented for CSP nonces (`packages/docs/150-custom-html-shell.md:71`: `html.replace('%nonce%', event.locals.nonce)`), where a hijack would put the nonce in the attacker's content position and leave a literal `%nonce%` in the real `<script nonce>`, breaking CSP enforcement for the page.

Separately, `String.replace`/`replaceAll` interpret `$` sequences in the *replacement* argument (`$$`, `$&`, `` $` ``, `$'`). `ANALYTICS_SCRIPT` contains none today, so this is latent, but any future tracker snippet with a `$` in it would be silently corrupted — `` $` `` would splice the entire preceding document into the output.

## Recommendation

Anchor the substitution instead of scanning the whole document: make it idempotent and occurrence-safe by replacing on a unique HTML comment marker, or split/rejoin on the last occurrence rather than the first. To neutralize the `$`-pattern hazard, pass a replacer function — `html.replace('{{mochi.analytics}}', () => (enabled ? ANALYTICS_SCRIPT : ''))` — which treats the value literally. Consider having the framework substitute shell placeholders before user content is interpolated, so `transformPage` consumers cannot be hijacked by rendered data at all.

## Revalidation

**Verdict:** true-positive

Not a duplicate of F3: F3 is about *where* the tracker is enabled (missing exclusions / query-string reporting), F4 is about *how* the substitution is performed — different root cause, different fix. The premise verified: `applyResolveOptions` (runtime/hooks.ts:170-183) is the only call site, it does `await result.text()` on the finished Response and passes that to `opts.transformPage` with `done: true`, so `{{mochi.body}}` is already replaced with rendered component output. `html.replace('{{mochi.analytics}}', …)` with a string pattern replaces only the first occurrence, and both shells place the placeholder at the very end of `<body>` (support:123, site:415), after all content — so any earlier occurrence wins. The attacker path is real: the unauthenticated `send` action (support/src/routes.ts) stores `message` after only whitespace-trim and a 5000-char slice, and `admin/SubmissionCard.svelte:23` renders `{submission.message}` in a text position where Svelte SSR escaping touches only `&` and `<` — `{{mochi.analytics}}` contains neither, so it reaches `transformPage` byte-identical and the tracker `<script>` is injected into the message paragraph while the real placeholder renders as literal text. I also found a publicly reachable variant the finding didn't name: `/newsletter/embed`'s `source` prop comes from `?src=` (newsletter/routes.ts:25) and lands in `NewsletterForm.svelte:64` as `value={source}` inside a double-quoted attribute; that path is excluded so `enabled` is false, meaning a crafted `?src={{mochi.analytics}}` swallows the empty-string replacement and leaves the real placeholder visible — same hijack, no auth needed. I confirmed the finding's own caveats: `ANALYTICS_SCRIPT` contains no `"` (only single quotes), so it cannot break out of a Svelte-emitted double-quoted attribute, and it contains no `$`, so the `$&`/`` $` `` replacement-pattern hazard is latent rather than live. So this is a robustness/correctness defect with attacker-controlled trigger and cosmetic impact today, exactly as filed — the fragility argument (the documented `%nonce%` variant at `150-custom-html-shell.md:71` would be a CSP break) is sound. BUG severity is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-05)
