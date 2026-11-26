# [BUG] headResponse() buffers the entire response body on HEAD, hanging forever on non-SSE streams and heap-allocating whole files GET would stream

**File:** [`packages/mochi/src/utils/index.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/utils/index.ts#L266-L295) (lines 266, 268, 269, 270, 271, 288, 295)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-resource-exhaustion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

headResponse() answers HEAD by fully draining the body (`await res.arrayBuffer()`), skipping that only when Content-Type contains 'text/event-stream'. The accompanying test (index.test.ts:265-277) shows the author knew an unbounded stream must not be buffered, but the escape hatch keys on one content type.

(1) Infinite/streaming non-SSE bodies hang and grow without bound. `withHead` is applied to every `Mochi.api()` route (Mochi.ts:1257) and to the catch-all fetch handler (Mochi.ts:1931). A perfectly ordinary streaming API route — NDJSON, a log tail, a proxied LLM token stream, `application/octet-stream` — answers HEAD by awaiting `arrayBuffer()` on a body that never ends. The promise never settles, the route handler never returns, and the buffer grows for the life of the process. The stream is one the framework holds itself, so a client disconnect does not cancel it. `api` routes also get `timeout: false` in KIND_POLICY, so nothing interrupts it. An unauthenticated attacker issuing a handful of HEADs at such a route grows the heap until OOM. The app author never opted into HEAD handling — `withHead` synthesizes it.

(2) Disk-backed assets are read fully into memory on HEAD where GET costs ~0. `/_mochi/asset/:filename` is wrapped in `withHead` (Mochi.ts:1727) and returns `new Response(Bun.file(...))` via serveDiskAsset; the catch-all's `serveDiskAsset` branch (Mochi.ts:1894) reaches headResponse the same way. GET streams those bytes off disk, but HEAD buffers the whole file into the heap just to compute a Content-Length that `Bun.file` already knows (`file.size`). Note `Mochi.file` (Mochi.ts:1492) and publicDir/staticDirs (native `Bun.file` / `{ dir }` route values) all avoid this correctly — so the pattern for the right fix is already in the codebase.

(3) Contract hazard: headResponse consumes the Response it is handed. Any caller that returns a shared/module-level Response from a handler would have its body disturbed by the first HEAD and would serve an empty or throwing body afterwards. No such call site exists today, but nothing documents the constraint.

## Recommendation

Stop buffering to learn the length. Branch on what the body actually is rather than on Content-Type: if `res.body` is absent, return as-is; if the body is a BunFile/Blob, use its `.size` for Content-Length; if Content-Length is already set, reuse it; otherwise return `new Response(null, …)` with no Content-Length at all (it is optional for HEAD) and cancel the body with `res.body.cancel()` so the producer is released. If buffering is kept for the small-finite case, bound it with a byte cap plus a timeout and fall back to no Content-Length when either trips. Separately, document that headResponse consumes its argument.

## Revalidation

**Verdict:** true-positive

Verified as described. `headResponse` (utils/index.ts:266-274) drains `await res.arrayBuffer()` for any body whose Content-Type does not contain `text/event-stream`, and `withHead` applies it to every `Mochi.api()` route (Mochi.ts:1257), both page arms (1182/1192), the island endpoint (1559), the image endpoint (1707) and the local-asset route (1727), while the catch-all `fetch` handler calls `headResponse(response)` directly on HEAD (1932). Claim (1) holds: an ordinary streaming non-SSE route (NDJSON, a log tail, `application/octet-stream`, a proxied token stream) answers HEAD by awaiting a body that never ends — the promise never settles, the handler never returns, and the buffer grows for the life of the process. Nothing cancels it in-process: the stream is one the handler owns, so a client disconnect does not cancel it, and the app never opted into HEAD at all (the object arm even synthesizes a `HEAD` entry so Bun does not 405). One correction to the finding's rationale: `api: { timeout: false }` in KIND_POLICY means `server.timeout(req, 0)` — which *disables* the idle timeout — is **not** called, so api requests keep Bun's default ~10s idle timeout rather than having none. That only closes the socket and aborts `req.signal`, though; it does not cancel the already-running `arrayBuffer()` drain, so the unbounded-growth conclusion survives even though the stated reason is inverted. Claim (2) holds: `serveDiskAsset` returns `new Response(Bun.file(path))` (serveDiskAsset.ts:22), reached both via `withHead(createLocalAssetHandler(...))` at 1727 and via the catch-all's `diskAsset` branch at 1894 → 1932, so HEAD reads a whole font/CSS/image file into the heap solely to compute a length `BunFile` already exposes as `file.size`. The correct pattern is already in the tree — `Mochi.file`'s HEAD arm at Mochi.ts:1492-1493 uses `file.size` — and `withHead`'s own doc comment ('`Response` and `BunFile` pass through untouched') is true only of a BunFile *route value*, not of a handler returning `new Response(file)`, so it actively misleads here. Claim (3) is a genuine undocumented constraint, latent only because index.ts:291 skips bare `Response`/`Blob` route values. The author's own test at index.test.ts:267-277 ('A never-ending stream: if headResponse buffered it, this test would hang') shows the hazard was understood and the guard was simply keyed on one content type. BUG is the right severity: it is reachable by an unauthenticated HEAD, but the unbounded-hang half requires the app to expose a streaming route, and the disk-asset half is bounded by file size (memory amplification rather than a true leak). The recommended fix — branch on what the body is (absent / BunFile-Blob `.size` / existing Content-Length / else omit Content-Length and `res.body.cancel()`) — is correct and mirrors the existing `Mochi.file` code.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
