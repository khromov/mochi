# [BUG] Action redirects to a slashless path on a trailingSlash: 'always' site, costing an extra 301 hop

**File:** [`packages/site/src/demos/form-redirects/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/form-redirects/routes.ts#L11) (lines 11)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`packages/site` runs with `trailingSlash: 'always'` (packages/site/src/index.ts:172), but the action redirects to `/demos/form-redirects?redirected=1` with no trailing slash. The browser therefore follows a 303 to that path, `trailingSlashRedirect` (packages/mochi/src/runtime/trailingSlash.ts:19-21) answers with a 301 to `/demos/form-redirects/?redirected=1`, and only the third request renders. Behaviour is correct — the query survives, since the redirect is built as `pathname + '/' + url.search` — so this is a wasted round trip rather than a functional break.

It matters slightly more here than in ordinary code because this demo is documentation: on the enhanced path, `RedirectDemo.svelte:36` renders the envelope's `location` verbatim to the reader as exemplary output, so the non-canonical URL is what the demo teaches. The repo is already inconsistent on this — `packages/site/src/demos/image-invalidation/routes.ts:25` redirects to the canonical `/demos/image-invalidation/`, while `packages/site/src/demos/login/routes.ts:35` has the same slashless form as this file — and CLAUDE.md explicitly documents that slashless paths on this site just redirect.

## Recommendation

Redirect to the canonical path: `redirect(303, '/demos/form-redirects/?redirected=1')`. Apply the same to packages/site/src/demos/login/routes.ts:35 so the demos are consistent with image-invalidation and with the site's own trailing-slash policy.

## Revalidation

**Verdict:** true-positive

Verified, and correctly filed as a BUG rather than a security issue. The site sets `trailingSlash: 'always'` (index.ts:172) while line 11 redirects to `/demos/form-redirects?redirected=1` with no trailing slash. Page routes are the only kind that mirror both slash forms (`mirrorsSlashForm` reads `KIND_POLICY[kind].trailingSlash`, true only for `page` — requestSetup.ts:62-78), so the slashless pattern is registered and the request matches rather than 404ing; `buildRequestContext` then runs `trailingSlashRedirect`, and with policy 'always' on a dot-free pathname that is not slash-exempt it returns `permanentRedirect(method, pathname + '/' + url.search)` — a 301 for GET (trailingSlash.ts:19-21, 52-55). So the browser makes three requests where two would do, and because `url.search` is re-attached the query survives: behaviour is correct, the cost is a wasted round trip. The documentation angle also checks out — RedirectDemo.svelte prints `location: "{redirectResult.location}"` verbatim on the enhanced path, so the non-canonical URL is literally what the demo shows the reader. So does the inconsistency claim: image-invalidation/routes.ts:25 redirects to the canonical `/demos/image-invalidation/`, while login/routes.ts:35 repeats the slashless form. Adding the slash in both places is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
