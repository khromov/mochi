# [BUG] Small-chunk streaming responses (text/event-stream) are latency-buffered by CompressionStream, production-only

**File:** [`packages/mochi/src/middleware/compress.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/middleware/compress.ts#L7-L67) (lines 7, 13, 38, 53, 67)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`COMPRESSIBLE_TYPES` matches on the bare `'text/'` prefix (L7, L13-16), so `text/event-stream` and any other small-chunk streaming body is treated as compressible and piped through `CompressionStream` (L67). A `CompressionStream` has no per-chunk flush: per the WHATWG spec it compresses each chunk and enqueues only whatever output the zlib/zstd context actually produced, and with the default flush mode that context buffers until it has a complete block. Small writes therefore produce zero output bytes, so the client receives nothing until enough data accumulates or the stream closes — exactly the reason Z_SYNC_FLUSH is required for SSE on node:zlib. The middleware's own doc comment claims the opposite ('a chunked SSR response stays chunked', L22), and the regression test at compress.test.ts:346 only proves this for a 16 KB first chunk ('head'.repeat(4096)), which is large enough to fill a block; it does not cover a 30-byte SSE frame. Framework-internal `Mochi.sse()` is not affected because the SSE route handler (Mochi.ts:1426) returns its Response directly without invoking `middleware`, and `Mochi.file`/publicDir/staticDirs likewise bypass the chain — but `Mochi.api()` responses DO run the chain (Mochi.ts:1240), and hand-rolling SSE or an NDJSON/token feed from a `Mochi.api()` route is the normal way to get custom headers or auth on a stream. The `isDev` bail at L38 means the middleware is a no-op in development, so a consumer sees a working stream locally and a stalled one in production. No app in this repo currently returns a ReadableStream from a `Mochi.api()` route, so impact today is on library consumers rather than the deployed sites.

## Recommendation

Exclude streaming media types from compression — at minimum add an explicit `text/event-stream` (and `application/x-ndjson`) deny-check before the `'text/'` prefix test, rather than relying on the prefix list. If per-chunk delivery for compressed streams is wanted, it needs a flush-capable compressor (node:zlib with Z_SYNC_FLUSH) instead of CompressionStream. Also extend compress.test.ts:346 with a small-chunk case (a few dozen bytes) asserting the chunk arrives before close, so the documented streaming guarantee is actually covered.

## Revalidation

**Verdict:** true-positive

The finding filed this at medium confidence; I was able to settle the decisive mechanism, and it holds. Statically: `COMPRESSIBLE_TYPES[0]` is the bare `'text/'` prefix and `isCompressible` is a `startsWith` test, so `text/event-stream` matches and line 67 pipes the body through `new CompressionStream(COMPRESSION_FORMAT[chosen])` with the default `methods: ['zstd', 'gzip']`. I then pulled Bun's own implementation (commit 5702b39, `src/js/builtins/CompressionStream.ts`): `CompressionStream` is a thin wrapper — `zlib.createGzip()` / `zlib.createZstdCompress()` bridged via `stream.Readable.toWeb` / `Writable.toWeb`. In Bun's `src/js/node/zlib.ts` the defaults are `zlibDefaultOpts = { flush: Z_NO_FLUSH, finishFlush: Z_FINISH }` (line 672) and `zstdDefaultOpts = { flush: ZSTD_e_continue, finishFlush: ZSTD_e_end }` (line 909); `ZlibBase.prototype._transform` (line 403) uses `_defaultFlushFlag` for every chunk and only raises to `_finishFlushFlag` for the final one, and `processCallback` pushes output only under `if (have > 0)` (line 571). So a ~30-byte frame mid-stream yields zero pushed bytes — there is no per-chunk flush, confirming the claim for Bun specifically, not just from the WHATWG algorithm. This also explains why the existing regression test is not coverage: gzip emits its 10-byte header on the first `deflate()` call, which alone satisfies `expect(first.value!.byteLength).toBeGreaterThan(0)` — 16 KB of `'head'.repeat(4096)` produces only ~68 LZ77 symbols, nowhere near a block flush. I verified the surrounding reachability claims too: `Mochi.sse()` (Mochi.ts:1330-1432) returns its Response directly with no `middleware` call, while `Mochi.api()` (line 1240) and `Mochi.page()` (line 991) run the chain, and `isDev` (`utils/env.ts`, a live `export let` seeded from `NODE_ENV === 'development'`) makes the middleware a no-op in dev — so a consumer sees a working stream locally and a stalled one in production. Current in-repo impact is nil: `grep 'new ReadableStream' packages/*/src` finds nothing, and the only SSE is `Mochi.sse('/sse/time')`, which bypasses the chain — so this is a latent bug for `mochi-framework` npm consumers, which is why I keep it at BUG rather than raising it. Two minor corrections: `application/x-ndjson` does *not* match `COMPRESSIBLE_TYPES`, so the affected set is really 'any `text/*` body streamed in small chunks' (a `text/plain` token feed included), and the L22 doc comment's streaming guarantee is only true for large chunks.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
