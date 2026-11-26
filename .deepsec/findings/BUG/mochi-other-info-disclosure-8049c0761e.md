# [BUG] Unpublished draft blog posts resolve to public, long-lived OG cards in the deployed container

**File:** [`packages/site/src/og/resolve.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/og/resolve.ts#L7-L34) (lines 7, 34)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`DEVELOPMENT` is derived from `NODE_ENV === 'development'` (L7) and is used to unhide drafts in the card resolver: `getPost(postSlug, { includeDrafts: DEVELOPMENT })` (L34). That flag is TRUE in production. The deployed site image is built from `Dockerfile` (confirmed by the `site` matrix leg in `.github/workflows/build.yml`, `dockerfile: Dockerfile`), whose entrypoint is `exec bun run dev:site`; root `package.json` maps `dev:site` → `bun --cwd=packages/site run dev`, and `packages/site/package.json` defines `dev` as `NODE_ENV=development bun src/index.ts`. The Dockerfile comment states this is deliberate ("Running in dev mode ... so the debug bar and dev overlays are visible in the deployed environment").

Attack scenario: an attacker who guesses or enumerates a draft slug requests `GET /og/blog/<draft-slug>.jpg`. `resolveOgSubject` returns `{ kind: 'blog', title: post.title, date: post.date }` for a post with `draft: true`, and `og/routes.ts` renders and returns a 200 JPEG with the unpublished post's title and publication date drawn onto it, instead of the 404 the same request would produce under a real production `NODE_ENV`.

Note on blast radius: `packages/site/src/routes.ts` has the same flag at L229/L241, so in that container `/blog/` already lists drafts and `/blog/<draft>/` already serves the full body — this file is not the only leak. What it adds that the page routes do not is cache lifetime: the card response sets `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` (og/routes.ts L38), and the framework's `noCache` middleware explicitly leaves a route's own `Cache-Control` untouched (`packages/mochi/src/middleware/noCache.ts` L14-16), whereas the blog pages fall through to `no-cache`. A draft's title and date therefore become publicly cacheable at any CDN/proxy for up to 7 days and keep being served after the draft is deleted or retitled. The server-side `MochiCache` in `og/cache.ts` also retains the rendered draft card for `maxTimeToLive: 604_800_000` ms.

## Recommendation

Stop using `NODE_ENV` as the draft gate in an image that ships `NODE_ENV=development` to production. Gate drafts on something that is false in the deployed container — e.g. `const SHOW_DRAFTS = process.env.MOCHI_DOCKER !== 'true' && process.env.NODE_ENV === 'development'`, or better an explicit `SHOW_DRAFTS=1` opt-in — and use the identical flag in `packages/site/src/routes.ts` (L229, L241) so the page and the card agree. Independently, make the OG route refuse to emit a cacheable response for a draft subject: have `resolveOgSubject` return `null` for `post.draft`, or carry a `draft` flag on `OgSubject` and downgrade those responses to `Cache-Control: private, no-store`. Add a test asserting that a `draft: true` fixture yields `null` from `resolveOgSubject` and a 404 from `/og/blog/<slug>.jpg` when the flag is off.

## Revalidation

**Verdict:** true-positive

The logic flaw is real and precisely diagnosed. `DEVELOPMENT = process.env.NODE_ENV === 'development'` (og/resolve.ts L7) is true in production: build.yml deploys the `site` leg from `Dockerfile`, whose ENTRYPOINT `bun run dev:site` resolves to `NODE_ENV=development bun src/index.ts`, and the Dockerfile comment says so deliberately. `getPost(slug, { includeDrafts: true })` therefore returns `draft: true` entries (lib/blog.ts L107-116, which only null-checks drafts when `includeDrafts` is falsy), `resolveOgSubject` hands back `{ kind: 'blog', title, date }`, and og/routes.ts L37-38 returns a 200 JPEG with `public, max-age=86400, stale-while-revalidate=604800` plus an ETag — so the card is publicly cacheable for up to 7 days and the server-side `MochiCache` holds it for `maxTimeToLive: 604_800_000` ms. The finding is also right that `noCache` leaves a route's own `Cache-Control` alone, and that routes.ts L229/L241 carry the identical flaw. I'm downgrading severity for three reasons. First, it is latent: `packages/site/src/blog/` contains four posts and none has `draft:` frontmatter, so nothing is leaking today. Second, the confidentiality value of the gate is near zero for this project — the repo is public (packages/cli/src/download.ts pulls `https://codeload.github.com/khromov/mochi/tar.gz/<ref>` with, in its own words, 'no auth'), so a draft's full markdown is already readable on GitHub; `draft: true` is an editorial publication flag, not a secrecy control. Third, the incremental exposure at this file is a title and a date, strictly less than the page routes in the same container that already render the whole draft body and list it on `/blog/`. Real bug worth fixing (gate drafts on something that is false in the deployed image, and refuse to emit a cacheable response for a draft subject), but not a MEDIUM information-disclosure.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
