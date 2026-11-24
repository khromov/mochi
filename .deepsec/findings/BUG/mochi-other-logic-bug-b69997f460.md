# [BUG] An unknown author slug in one post's frontmatter makes /feed.xml 500 on every request

**File:** [`packages/site/src/lib/feed.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/feed.ts#L42) (lines 42)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L42 calls `getAuthor(post.author).name` for every post. `getAuthor` (lib/authors.ts:15-20) throws `Unknown author slug: ...` for anything not in the hardcoded `authors` record. `blog.ts:78-80` validates only that the `author` field is *present*, never that it resolves — so a typo (or a new author added to a post but not to `authors.ts`) passes load-time validation and surfaces later as an uncaught throw inside feed generation, which `Mochi.api` turns into a 500.

It is permanent rather than transient: `cachedFeedXml` is only assigned after the whole `posts.map` completes (L47), so the throw escapes before anything is cached and every subsequent request re-throws. One bad frontmatter field in any single post takes the entire RSS feed down for all subscribers, while `/blog/` itself keeps rendering (the index route doesn't resolve authors), so the failure is easy to miss. Secondary nit in the same path: `pubDate` (L19-21) passes the regex-validated-but-not-range-validated date straight to `new Date()`, so a value like `2024-13-45` yields `<pubDate>Invalid Date</pubDate>` rather than an error.

## Recommendation

Validate the author slug where the other frontmatter checks live (blog.ts's `loadAllPosts`, i.e. fail loudly at load with the filename), or make the feed resilient — fall back to the raw slug/site name instead of throwing. Range-check the date while you're there (`Number.isNaN(new Date(...).getTime())`).

## Revalidation

**Verdict:** true-positive

Every step checks out. feed.ts:42 calls `getAuthor(post.author).name` inside the `posts.map`, and authors.ts:15-20 throws `Unknown author slug: …` for anything outside the single-entry `authors` record. blog.ts:78-80 validates only `if (!metadata.author)` — presence, never resolvability — so a typo or a newly-added author passes load-time validation and only detonates later. The permanence claim is right and is the sharpest part of the finding: `cachedFeedXml` is assigned at L47, *after* the whole `posts.map` at L33-45 completes, so the throw escapes with nothing memoised and every subsequent request repeats it; `/feed.xml` is a `Mochi.api()` route, and a non-`MochiHttpError` throw becomes a hard 500 via `routeErrorResponse` (runtime/errors.ts:119-122). The secondary nit is also correct: `DATE_RE = /^\d{4}-\d{2}-\d{2}$/` accepts `2024-13-45`, which `new Date(...).toUTCString()` renders as the literal string `Invalid Date` inside `<pubDate>`. Two refinements. First, the blast radius is slightly wider than stated: BlogPost.svelte:31 also calls `getAuthor(author)` in a `$derived`, so that post's own page 500s too — only `/blog/` (which never resolves authors), the sitemap and the llms.txt routes keep working, so it is a bit less silent than described. Second, a mitigation the finding omits: feed.test.ts exercises `buildFeedXml()` against the real `src/blog` contents and asserts `dc:creator`, so a bad author slug in a published post fails `bun run checks` before it could ship. That is a process guard rather than a code guard, and it does not cover the underlying design issue — validation sitting in the wrong place and a cache that cannot degrade gracefully — so the BUG-severity finding stands.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
