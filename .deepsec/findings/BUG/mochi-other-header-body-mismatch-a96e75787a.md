# [BUG] transformPage replaces the body but copies Content-Length, ETag and Content-Encoding verbatim

**File:** [`packages/mochi/src/runtime/hooks.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/hooks.ts#L170-L182) (lines 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-header-body-mismatch`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

When `transformPage` rewrites an HTML body, the new Response is constructed with `new Headers(result.headers)` — every entity header from the original is carried over unchanged while the bytes underneath them have changed. A response that arrived with an explicit `Content-Length` (e.g. a form action or `fetch` fallback returning `new Response(Bun.file('page.html'))`, which Bun populates automatically, or a handler that sets it by hand) ships a length that no longer matches the transformed body, and any `ETag`/`Last-Modified` validator now identifies the *untransformed* entity — so a CDN or conditional request can revalidate or serve the pre-transform HTML under the transformed response's identity. The same copy preserves a stale `Content-Encoding` if an upstream-compressed HTML response reaches the hook, in which case `result.text()` has already decoded the body.

The framework elsewhere handles exactly this: `middleware/compress.ts:63-64` sets Content-Encoding and explicitly `headers.delete('Content-Length')` because it changed the body, and `appendDebugTail` (Mochi.ts:186-188) bails out entirely when `Content-Encoding` is present. applyResolveOptions does neither, and `transformPage` has no test coverage anywhere in the repo.

## Recommendation

Before constructing the transformed Response, drop the headers that describe the old body: `headers.delete('Content-Length')`, `headers.delete('ETag')`, `headers.delete('Last-Modified')`, and either skip transformation or delete `Content-Encoding` when one is set (mirroring appendDebugTail's guard).

## Revalidation

**Verdict:** true-positive

Confirmed as a real latent defect, distinct from F4 (different lines, different mechanism — entity-header/body divergence rather than Set-Cookie collapse), so not a duplicate. hooks.ts:176-181 constructs the transformed Response with new Headers(result.headers), carrying every entity header across a body rewrite. The Content-Length half hinges on whether Bun honors an explicit value, and it does: Bun v1.1.43 added 'Override Content-Length and Transfer-Encoding in Bun.serve()' with the example new Response('Hello World', { headers: { 'Content-Length': '7' } }), and Mochi itself depends on that behavior for HEAD at Mochi.ts:1492-1493. The trigger is plausible: new Response(Bun.file('page.html')) populates Content-Length (Mochi.ts:1495 states this, and Bun's routing docs confirm automatic Content-Length/Content-Range for file bodies), its type is text/html so it enters the transform branch, and such a Response reaches applyResolveOptions from a fetch fallback (Mochi.ts:1908), a form action returning its own Response (1130), a handleError Response (errors.ts:75), or an API route (1227) — shipping a declared length that no longer matches the bytes. The ETag/Last-Modified half is unambiguous in code and matters most for transformPage's documented purpose: docs/125-transform-page.md:57 says to use it for request-dependent values only (nonces, A/B classes), so a per-request transform under an entity validator computed for the untransformed file is exactly the shape a shared cache mishandles. transformPage is live in all three deployed apps (shared/src/index.ts:23-29 analytics, site/src/index.ts:67 and :100, site/src/shot/routes.ts:33), though no in-repo handler currently returns an HTML Response carrying these headers, so the bug is latent rather than firing today. Two notes on the write-up: the in-repo precedents are real but only half-consistent — compress.ts:62-64 does copy headers and explicitly delete('Content-Length') because the body changed, and appendDebugTail bails on Content-Encoding (Mochi.ts:186-188), yet appendDebugTail then appends to the body while reusing response.headers verbatim (L198-202), i.e. it has the same Content-Length gap. And the Content-Encoding rationale ('result.text() has already decoded the body') only holds for a Response obtained from fetch(); for a locally-constructed pre-compressed body .text() does not decode, in which case the transform corrupts the compressed bytes instead. Either way transforming an encoded body is wrong. Confirmed zero test coverage for transformPage anywhere in the monorepo.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
