# [MEDIUM] Unpublished draft blog posts are served publicly because the deployed site runs with NODE_ENV=development

**File:** [`packages/site/src/lib/blog.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/blog.ts#L102-L112) (lines 102, 104, 107, 112)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The draft/published boundary is implemented here via the `includeDrafts` option: `loadPosts()` filters `p.draft` and `getPost()` returns null for a draft unless the caller opts in. Every caller that must hide drafts does so correctly, and the code states this as an invariant — `feed.ts:31` and `docs.ts:299` both say "loadPosts() without includeDrafts never exposes drafts", `docs.ts:327-329` says "Drafts stay hidden", and `blogComponents.prerender.ts:5` says drafts are bundled but "`loadPosts()` at runtime is what keeps them out of production responses".

That invariant is false in the actual deployment. The two public blog routes opt in conditionally: `routes.ts:229` calls `loadPosts({ includeDrafts: DEVELOPMENT })` and `routes.ts:241` calls `getPost(slug, { includeDrafts: DEVELOPMENT })`, where `DEVELOPMENT = process.env.NODE_ENV === 'development'` (routes.ts:89). The deployed site image sets exactly that: the root `Dockerfile` ends with `ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]`, `dev:site` is `bun --cwd=packages/site run dev`, and `packages/site/package.json` defines `"dev": "NODE_ENV=development bun src/index.ts"`. The Dockerfile header states this is deliberate ("Running in dev mode ... so the debug bar and dev overlays are visible in the deployed environment") and CLAUDE.md confirms `Dockerfile` is "the variant deployed for site + demos".

So on the live site `DEVELOPMENT` is true and `includeDrafts` is true: an unauthenticated visitor to `/blog/` sees every draft listed (with the `Draft` badge from Blog.svelte:54-55), and `/blog/<draft-slug>/` renders the full unpublished post. `og/resolve.ts:34` compounds it by minting OG preview images for drafts. Note the drafts are simultaneously omitted from `/sitemap.xml`, `/feed.xml`, `/llms*.txt` and `/mcp` (those call `loadPosts()`/`getPost()` with no opts), which is why the leak is easy to miss — the author's mental model of "hidden in prod" holds everywhere except the two surfaces that matter most.

Currently latent rather than actively leaking: none of the four posts in `packages/site/src/blog/` carries `draft: true`. It becomes a live pre-publication content disclosure the moment an embargoed post is committed, which is precisely the workflow the `draft` flag and `Draft` badge exist to support.

## Recommendation

Stop deriving the draft gate from NODE_ENV, which this deployment intentionally pins to `development`. Introduce a separate, explicitly-opt-in flag (e.g. `SHOW_DRAFTS === 'true'`, unset in the Dockerfile) and use it at `routes.ts:229`, `routes.ts:241` and `og/resolve.ts:34`. Better still, make the safe path the default inside blog.ts: have `getPost()`/`loadPosts()` require an explicit `includeDrafts: true` from a single `draftsVisible()` helper so the policy lives in one auditable place, and add a test that asserts `/blog/<draft>/` returns 404 when that flag is unset even with NODE_ENV=development.

## Revalidation

**Verdict:** true-positive

I verified every link in the chain independently. `blog.ts:104` filters `p.draft` only when `includeDrafts` is falsy and `blog.ts:112` returns null for a draft only when `includeDrafts` is falsy — so the gate is entirely caller-supplied. The two public blog routes supply it conditionally: `routes.ts:229` `loadPosts({ includeDrafts: DEVELOPMENT })` and `routes.ts:241` `getPost(slug, { includeDrafts: DEVELOPMENT })`, with `DEVELOPMENT = process.env.NODE_ENV === 'development'` at `routes.ts:89`. The deployed image sets exactly that: root `Dockerfile:79` is `ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]`, root `package.json:21` defines `dev:site` as `bun --cwd=packages/site run dev`, and `packages/site/package.json:14` defines `dev` as `NODE_ENV=development bun src/index.ts`. The Dockerfile header states the dev-mode choice is deliberate, and `.github/workflows/build.yml` confirms the site and demos legs both build `file: Dockerfile` (only the `support` leg uses `Dockerfile.production`). No env file overrides it — `.dockerignore` strips `.env*` from the build context and the root `.env` sets no `NODE_ENV` anyway. So on the live site both calls pass `includeDrafts: true`: `/blog/` lists drafts (with the `Draft` badge) and `/blog/<draft-slug>/` renders the full post to any anonymous visitor, and `og/resolve.ts:34` mints a social card for it. The code's own comments assert the opposite invariant (`feed.ts:31`, `docs.ts:299`, `docs.ts:327-329`, `blogComponents.prerender.ts:5`), and the existing tests (`blog.test.ts`, `feed.test.ts`, `sitemap.test.ts`) only cover the library default — nothing asserts the route behaviour, which is why the drift survived. I confirmed the finding's own caveat: none of the four files in `packages/site/src/blog/` carries `draft: true`, so nothing is leaking at this instant. I am still calling this a true positive and holding MEDIUM: the access-control decision is genuinely inverted in the shipped configuration, the exposure is one commit of embargoed content away, and the `draft` flag plus `Draft` badge exist precisely to stage such content — an authorisation control that is off in production is a real defect regardless of how many records currently sit behind it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-08)
