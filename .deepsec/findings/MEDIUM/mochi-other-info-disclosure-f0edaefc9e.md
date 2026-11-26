# [MEDIUM] Draft blog posts are publicly readable because the deployed site runs NODE_ENV=development

**File:** [`packages/site/src/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/routes.ts#L89-L241) (lines 89, 229, 241)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`DEVELOPMENT` is `process.env.NODE_ENV === 'development'`, and it gates draft visibility: `/blog` calls `loadPosts({ includeDrafts: DEVELOPMENT })` and lists every returned post (slug, title, description, date, draft), and `/blog/:slug` calls `getPost(slug, { includeDrafts: DEVELOPMENT })`. The public mochi.fast container runs in dev mode by design — the root `Dockerfile` ENTRYPOINT is `bun run dev:${WORKSPACE}` and `packages/site`'s `dev` script is `NODE_ENV=development bun src/index.ts`; the CI matrix comment confirms 'Deployed in dev mode … so the debug toolbar and dev overlays are visible', and `lib/debugBarEncode.ts:1` states it outright ('This site runs in dev mode in production'). So `DEVELOPMENT` is true in production and a post marked `draft: true` is fully listed on /blog/ and readable at /blog/<slug>/ the moment it is committed. The repo's own code shows this is not the intent: every other surface hides drafts unconditionally — `buildSitemapXml` and `buildFeedXml` call `loadPosts()` with no options, and `getPostLlmsTxt` calls `getPost(slug)` with no options, so `/blog/<slug>/llms.txt` 404s for the very post whose HTML page serves fine. That asymmetry means `includeDrafts: DEVELOPMENT` was written as 'local only', which this deployment is not.

## Recommendation

Gate drafts on something that is false in the deployed container — e.g. `const SHOW_DRAFTS = process.env.MOCHI_DOCKER !== 'true' && DEVELOPMENT`, or an explicit `SHOW_DRAFTS=1` opt-in — and use the same flag in `og/resolve.ts:34`. Add a test asserting a `draft: true` fixture 404s when the draft flag is off.

## Revalidation

**Verdict:** true-positive

The broken control is real and verified. routes.ts:89 defines `const DEVELOPMENT = process.env.NODE_ENV === 'development'`; line 229 calls `loadPosts({ includeDrafts: DEVELOPMENT })` and maps every returned post into props including `draft`; line 241 calls `getPost(slug, { includeDrafts: DEVELOPMENT })`. blog.ts:102-116 shows those options are the only thing hiding a draft — `loadPosts` filters on `!p.draft` unless `includeDrafts`, and `getPost` returns `null` for a draft unless `includeDrafts`. And `DEVELOPMENT` is true in the deployed container: the root Dockerfile's ENTRYPOINT is `bun run dev:${WORKSPACE}`, packages/site's `dev` script is `NODE_ENV=development bun src/index.ts`, build.yml's site leg builds from that Dockerfile, its matrix comment says "Deployed in dev mode … so the debug toolbar and dev overlays are visible", and lib/debugBarEncode.ts:1 opens with "This site runs in dev mode in production". The finding's strongest argument also checks out: every other surface hides drafts unconditionally — `buildSitemapXml` (docs.ts:300) and `buildFeedXml` call `loadPosts()` with no options, and `getPostLlmsTxt` (docs.ts:330) calls `getPost(slug)` with no options, so `/blog/<slug>/llms.txt` would 404 for a post whose HTML page serves fine. That asymmetry is strong evidence `includeDrafts: DEVELOPMENT` was written to mean "local only", which this deployment is not. The recommendation's pointer to og/resolve.ts:34 is also correct — it repeats the same `getPost(postSlug, { includeDrafts: DEVELOPMENT })` pattern. One material scoping fact the finding omits: there are currently no drafts. `ls packages/site/src/blog/` returns four posts and `grep '^draft:'` across them returns nothing, so nothing is being disclosed right now. The exposure is latent: the moment a `draft: true` post is committed — the exact case the flag exists for, e.g. an embargoed release announcement staged ahead of a launch — it is listed on /blog/ and readable at /blog/<slug>/ with no gate. I am leaving severity at MEDIUM: the control failure is unconditional and the content class (pre-publication announcements on a release-blogging site) is a genuine if modest confidentiality concern, even though today's concrete impact is zero.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-08)
