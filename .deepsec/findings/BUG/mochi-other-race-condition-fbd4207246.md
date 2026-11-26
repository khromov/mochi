# [BUG] Blog cache invalidation can be undone by an in-flight load, pinning stale post content

**File:** [`packages/site/src/lib/blog.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/blog.ts#L50-L97) (lines 50, 52, 97)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`clearBlogCaches()` nulls `cache.posts` and `cache.bySlug`, and is wired to `file:change` in `index.ts:37-44`. `loadAllPosts()` reads every post off disk across several `await` points (lines 57-65) before writing its result back at lines 97-98. If a `file:change` fires after an in-flight `loadAllPosts()` has already read the files but before it reaches line 97, the invalidation is silently overwritten with the pre-edit snapshot. The dev server then keeps serving the stale post body (and stale feed/sitemap, since those caches were cleared and will repopulate from this cache) until an unrelated subsequent edit happens to re-trigger the watcher. Narrow window and self-healing, but it is the classic read-modify-write-after-invalidate shape, and it is the kind of thing that reads as "the hot reload is flaky" rather than as a bug.

## Recommendation

Guard the write with a generation counter: capture a module-level `epoch` at entry to `loadAllPosts()`, have `clearBlogCaches()` increment it, and skip the assignment at lines 97-98 if the epoch moved. Deduplicating concurrent loads behind a single in-flight promise (and clearing that promise in `clearBlogCaches()`) fixes the redundant filesystem scans at the same time.

## Revalidation

**Verdict:** true-positive

The shape is exactly as described and there is no guard anywhere in the module. `loadAllPosts()` returns early on a populated `cache.posts` (L51), then suspends repeatedly — `glob.scan` (L57), `Bun.file().text()` (L64), and `parsePostFrontmatter`'s `mdsvexCompile` (L65) per file — before writing `cache.posts` and `cache.bySlug` at L97-98. `clearBlogCaches()` (L35-38) nulls both synchronously and is subscribed to `file:change` at `index.ts:37-44`. Because JS interleaves only at await points, the invalidation can land between L64's read of a file's pre-edit bytes and L97's assignment; the assignment then reinstates the pre-edit snapshot over a cache that was just invalidated, and nothing re-clears it. The blast radius is slightly wider than one post: `index.ts:40-42` also calls `clearFeedCache()` and `clearDocsCaches()`, and `feed.ts`/`buildSitemapXml` repopulate from this same `cache.posts`, so the stale body propagates into the feed and sitemap caches too, persisting until an unrelated later edit happens to re-trigger the watcher outside the window. There is no in-flight dedupe either, so concurrent cold loads also redo the whole filesystem scan. I agree with BUG severity and with the finding's low-impact framing: the `file:change` subscription is inside `index.ts:28`'s `NODE_ENV === 'development'` block, and although the deployed container also runs with `NODE_ENV=development`, nothing rewrites `src/blog/*.md` at runtime there, so in practice this is a dev-server hot-reload staleness bug with a window of one `loadAllPosts()` pass (four small files) and it self-heals on the next save. Real defect, correctly classified as a correctness nit rather than a security issue.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-08)
