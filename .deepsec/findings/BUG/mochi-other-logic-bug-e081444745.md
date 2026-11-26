# [BUG] Protocol-relative URLs (//evil.com) are misclassified as internal and skip rel hardening

**File:** [`packages/site/src/lib/rehypeExternalLinks.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/rehypeExternalLinks.ts#L12-L34) (lines 12, 34)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`isInternalLink()` short-circuits on `href.startsWith('/')` at line 12, intended to catch root-relative paths. A protocol-relative URL such as `//evil.com/x` also starts with `/`, so it returns true and `processLink()` returns early at line 34 — the link gets neither `target="_blank"` nor `rel="noopener noreferrer nofollow"`, despite pointing at a third-party origin. Browsers resolve `//evil.com/x` against the page scheme and navigate off-site normally, so the plugin's entire purpose is bypassed for that form.

Security impact is limited rather than absent: no `target` is set, so there is no `window.opener` handle, and modern browsers' default `strict-origin-when-cross-origin` referrer policy caps the `noreferrer` leak at the bare origin (I checked — the site sets no explicit `Referrer-Policy`). The concrete losses are the missing `nofollow` on an outbound link in first-party docs and the inconsistency with the `index.ts:122` build-time docs pipeline, which uses this same plugin. Worth noting alongside it that the catch-all `return true` on URL-parse failure and on non-http(s) schemes (lines 17-24) makes "internal" the default for everything unrecognized, including `javascript:` — see the changelog XSS finding, where that behavior means the plugin steps aside for exactly the dangerous schemes.

## Recommendation

Only treat single-slash paths as internal: replace `href.startsWith('/')` with `(href.startsWith('/') && !href.startsWith('//'))`, or resolve every href against a known base with `new URL(href, 'https://mochi.fast')` and compare the resulting hostname, which handles root-relative, protocol-relative and absolute forms uniformly. Consider inverting the unknown-scheme default so unrecognized schemes are treated as external (or stripped) rather than trusted.

## Revalidation

**Verdict:** true-positive

The misclassification is real and I traced it precisely. `isInternalLink('//evil.com/x')` returns true at line 12 because the string starts with `/`, so `processLink` returns at line 34 and the node gets neither `target="_blank"` nor `rel="noopener noreferrer nofollow"`, even though the browser resolves `//evil.com/x` against the page scheme and navigates cross-origin. The surrounding tests confirm the intent: there is a 'skips absolute path links' case for `/docs/intro` but no protocol-relative case anywhere in rehypeExternalLinks.test.ts, so this is an unhandled form rather than a deliberate choice. The finding's impact analysis is honest and I verified its two supporting claims: no `Referrer-Policy` header is set anywhere in packages/site or packages/mochi (so the leak is capped by the browser default `strict-origin-when-cross-origin`), and the plugin genuinely feeds both pipelines — the build-time docs/blog compile (index.ts:122) and the runtime `renderMarkdown` used for the GitHub-fetched changelog (lib/markdown.ts:62, lib/changelog.ts:46). With no `target` set there is no `window.opener` handle, so the concrete losses are the missing `nofollow` on an outbound first-party-docs link and the pipeline inconsistency, which is why BUG rather than a security severity is correct. The input is first-party (maintainer-authored markdown, plus the project's own release-please changelog), and I found no protocol-relative links in packages/docs or packages/site/src/blog today — so this is a latent correctness gap in a hardening helper, not a live exploit. The side observation about the catch-all `return true` on parse failure and unknown schemes (lines 17-24) is also accurate as read.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-26)
