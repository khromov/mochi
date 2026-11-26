# [BUG] Upstream response bodies are left un-cancelled on three throw paths in the redirect/validation loop

**File:** [`packages/mochi/src/image/fetchSource.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/fetchSource.ts#L103-L118) (lines 103, 113, 118)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The redirect loop is careful to `await res.body?.cancel()` when it *follows* a redirect (L105), but three throw paths abandon a live body without consuming or cancelling it:

- L102-104: `if (hop >= maxRedirects) throw new ImageError(502, 'Too many redirects')` — thrown while the final 3xx response body is untouched.
- L112-114: `if (!res.ok) throw new ImageError(502, …)` — also the landing spot for a 3xx response that carried no `Location` header, which `break`s out of the loop at L109 with its body intact.
- L117-119: the `content-length` pre-check throws before `readWithMaxSize` is ever entered, so no iterator is created over `res.body` and nothing cancels it.

(`readWithMaxSize`'s own L130-132 throw is fine — an abrupt completion inside `for await … of` invokes the async iterator's `return()`, which cancels the stream.)

Each leaked body holds its stream and underlying socket until GC reclaims it. These are precisely the attacker-reachable paths when an app mints from a user-supplied `src`: an upstream that always 302-loops, always returns a non-2xx, or always advertises an oversize `Content-Length` leaks one body per request, so a sustained request stream accumulates sockets/buffers.

## Recommendation

Cancel the body on every exit that does not read it. The cleanest shape is a small helper — `const fail = async (status, msg) => { await res.body?.cancel().catch(() => {}); throw new ImageError(status, msg); }` — used at all three sites, or a `try/finally` around the loop body that cancels any `res` whose body was never consumed. Also wrap `new URL(location, resolved.url)` (L106) in a try/catch so a malformed `Location` surfaces as a 502 rather than escaping as a raw `TypeError` that the endpoint reports as a generic 500.

## Revalidation

**Verdict:** true-positive

All three sites are exactly where the finding says and the asymmetry is unmistakable. The redirect-follow path carefully does `await res.body?.cancel()` at L105 before continuing, while: L102-104 throws `ImageError(502, 'Too many redirects')` with the final 3xx response's body untouched; L109 `break`s out for a 3xx that carried no `Location`, landing at L112-114's `if (!res.ok) throw` with the body intact; and L117-119's Content-Length pre-check throws before `readWithMaxSize` is ever entered, so no async iterator is ever created over `res.body`. I also confirmed the finding's own carve-out is right — `readWithMaxSize`'s L130-132 throw is an abrupt completion inside `for await (const chunk of res.body ?? [])`, which invokes the async iterator's `return()` and cancels the stream (`values()` defaults to `preventCancel: false`). The secondary claim is correct too: `new URL(location, resolved.url)` at L106 is unguarded, so a malformed `Location` escapes as a bare `TypeError`, which neither `fetchImageSource` nor the endpoint's `err instanceof ImageError` checks catch, surfacing as a generic 500 'Image processing failed' instead of a 502. One mitigating factor the finding omits, which is why I keep this at BUG rather than treating the DoS framing at face value: a single `AbortSignal.timeout(opts.fetchTimeoutMs)` (L71) is passed to every `fetch` in the chain, so when it fires (10 s default) the abort propagates to the still-open fetch and errors its body stream. The leak is therefore bounded to roughly `fetchTimeoutMs` per request rather than persisting until GC, so 'a sustained request stream accumulates sockets/buffers' overstates it. The defect itself — three exits that abandon a live body on a path reachable from attacker-influenced upstreams — is real, cheap to fix, and the suggested `fail()` helper or `try/finally` is the right shape.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
