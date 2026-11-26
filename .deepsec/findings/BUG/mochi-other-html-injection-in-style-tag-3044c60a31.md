# [BUG] Collected stylesheet is interpolated into <style> without neutralizing a `</style` sequence

**File:** [`packages/mochi/src/email/render.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/email/render.ts#L25-L39) (lines 25, 39)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-html-injection-in-style-tag`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Line 39 builds the email document by concatenating the collected stylesheet straight into a `<style>` element: `${css ? `<style>${css}</style>` : ''}`. `css` is the joined content of every file in `result.cssUrls`, which per `ComponentRegistry.renderStatic` (ComponentRegistry.ts:1616-1631) includes not only `.svelte` scoped style blocks but also plain `.css` files imported by the template (`entryImportedCss` -> `importedCssUrls`; exercised by render.test.ts's `import './fonts.css'` case). A `.svelte` <style> block can never contain the literal `</style` — the Svelte parser closes the tag first, the same trap CLAUDE.md documents for `</script>` — but an imported `.css` file (a project stylesheet, or third-party CSS from a package) legally can, inside a string value (`content: "</style>"`) or a comment (`/* see </style> */`). When that happens the head `<style>` element terminates early: the remainder of the stylesheet is re-parsed by css-inline's html5ever as HTML markup, so the rules css-inline needs are truncated (the email ships largely unstyled) and the leftover CSS text is serialized as visible document content in the delivered mail. The repo already applies exactly this neutralization on the analogous `<script>` interpolation path — `islands/islandPropsRegistry.ts:68` does `json.replace(/</g, '\\u003C')` before embedding serialized props — so this is an inconsistency with an in-repo precedent rather than an unknown hazard. This is NOT a security issue: `css` is compiler output derived from developer-authored sources and never from request data, so it is not attacker-controlled.

## Recommendation

Neutralize the sequence before interpolating, e.g. `const safeCss = css.replaceAll('</style', '<\\/style')` — in CSS, `\\/` is a valid escape for `/` inside a string and harmless inside a comment, and `</style` cannot legally appear anywhere else in a stylesheet. Alternatively hand the stylesheet to css-inline out-of-band via its `extraCss` option (or `inlineFragment(html, css)`) so the CSS never has to survive an HTML-parsing round trip, keeping only genuinely non-inlinable rules (media queries, pseudo-classes) in the escaped `<style>` block that `keepStyleTags: true` preserves. Worth a regression test with an imported `.css` file containing `content: "</style>"`.

## Revalidation

**Verdict:** true-positive

Verified at the source level. render.ts:39 concatenates the collected stylesheet directly into a head `<style>` with no neutralization, and I confirmed `css` can come from plain `.css` files rather than only Svelte style blocks: `ComponentRegistry.renderStatic` pushes `cssFileUrls` entries *and* `entryImportedCss` → `importedCssUrls` entries into `cssUrls` (ComponentRegistry.ts:1615-1631), and `email/render.test.ts:115-121` already exercises exactly that with an `import './fonts.css'`. I also checked that nothing downstream sanitizes: `stripFontFaces` (cssFontAssets.ts:261-271) uses MagicString surgery so the surrounding CSS text is byte-preserved, and `inline(doc, { keepStyleTags: true })` only parses and re-serializes. The finding's described consequence is correct per the HTML spec: `</style` terminates the RAWTEXT element, so css-inline receives a truncated rule set (the mail ships largely uninlined), and the leftover stylesheet text, being non-whitespace character data in `in head`, forces head→after head→in body and is serialized as visible text at the top of the message body. The repo's own analogous `<script>` path does neutralize (`islandPropsRegistry.ts:68` does `json.replace(/</g, '\u003C')`), and I confirmed via grep that email render is the *only* place in `packages/mochi/src` where non-constant CSS is inlined into a `<style>` element — page routes serve CSS via separate `clientFiles` URLs — so this is a genuine one-off gap, not a repo-wide pattern. The one residual uncertainty, which I am not able to settle by static analysis alone, is whether Bun's CSS printer preserves `</style>` inside a string literal, since imported CSS is bundled with `minify: true` (ComponentRegistry.ts:2196-2203); minification strips the comment variant outright, but a `content: "</style>"` string should survive because CSS string serializers escape only quotes, backslashes and control characters, not `<` or `/`. I agree with the finding's own classification that this is not a security issue — `css` is compiler output from developer-authored or third-party sources, never request data — so BUG is correct, and the suggested `replaceAll('</style', '<\\/style')` or passing the sheet to css-inline out-of-band via `extraCss` is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-14)
