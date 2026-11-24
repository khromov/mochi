# [BUG] Dev server stdout/stderr are piped but never read — swallows boot diagnostics and can stall the server on pipe backpressure

**File:** [`packages/site/scripts/shoot.ts`](https://github.com/khromov/mochi/blob/main/packages/site/scripts/shoot.ts#L114-L122) (lines 114, 115, 121, 122)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Bun.spawn is called with `stdout: 'pipe'` and `stderr: 'pipe'` (L114-115), which per Bun's docs expose `ReadableStream`s on the Subprocess. Nothing in the file ever consumes them — `proc` is referenced only at L121 (`.exitCode`), L127 and L134 (`.kill()`).

Two consequences:

1. Diagnostics are destroyed. The boot-failure path at L121-123 throws `Dev server exited with code N before it started answering.` while the stderr that explains *why* (a port collision, a Svelte compile error, a missing env var) sits unread in the pipe and is discarded. The same applies to the 120s timeout path at L135. The script buffered the one thing the operator needs and then threw it away.

2. The dev server can stall. An OS pipe applies backpressure: once the kernel buffer (~64KB) fills with undrained output, the writer blocks. Mochi's `consoleLogger()` prints a line per HTTP request plus compile/build output, so a boot that logs heavily — or any `--keep-open` session, which deliberately leaves the server running indefinitely with no reader — can block the dev server mid-write and silently freeze request handling. The symptom would look like a hung page load rather than a stalled pipe.

## Recommendation

Either drain the streams (tee them to the parent's output, or accumulate a bounded tail buffer) and include the captured stderr in both the early-exit and timeout error messages, or use `stdout: 'inherit'` / `stderr: 'inherit'` so output flows straight through and no pipe can back up. `backend: { stdout: 'inherit', stderr: 'inherit' }` is the equivalent knob Bun documents for the WebView's own browser process.

## Revalidation

**Verdict:** true-positive

The first half is certain and verified exhaustively: `Bun.spawn` is called with `stdout: 'pipe'` and `stderr: 'pipe'` (L114-115), which per Bun's docs expose `ReadableStream`s on the `Subprocess`, and `proc` is referenced only at L121 (`.exitCode`), L127 and L134 (`.kill()`) — nothing in the file ever reads either stream, and `startDevServer` returns only `{base, stop}`, so no closure retains them either. That means both failure paths throw the least useful error available while holding the explanation unread: L121-123 raises `Dev server exited with code N before it started answering.` and L135 raises the 120s timeout, in each case discarding the stderr that would name the port collision, Svelte compile error, or missing env var. For this package that is a real operator cost, since `packages/site`'s dev entry is a full Mochi boot with compilation. The second half — pipe backpressure stalling the dev server — is plausible but not something I can establish from source alone: Bun's docs do not specify whether an unconsumed `pipe` stream is drained into an internal buffer or left in the OS pipe, so whether the ~64KB kernel buffer fills and blocks the writer depends on Bun internals I'd have to run to confirm (and the task is static-analysis only). The scenario is nonetheless well-motivated for the `--keep-open` path specifically: `stopServer` stays undefined there (L200-202), so the server runs indefinitely with `consoleLogger()` emitting a line per request and no reader attached, and per Bun's spawn docs the parent cannot exit while that child lives. I'm scoring this true-positive on the certain half; the recommendation (drain and include the captured stderr in both error messages, or just use `'inherit'`) resolves both halves at once.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
- Stanislav <stanislav.khromov@gmail.com> (2026-08-22)
