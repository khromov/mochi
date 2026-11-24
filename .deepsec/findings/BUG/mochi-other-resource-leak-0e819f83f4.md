# [BUG] WebView constructed outside the try/finally that stops the dev server — a construction failure orphans or wedges it

**File:** [`packages/site/scripts/shoot.ts`](https://github.com/khromov/mochi/blob/main/packages/site/scripts/shoot.ts#L212-L271) (lines 212, 221, 269, 271)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

startDevServer() spawns `bun run dev` (L111) and main() only installs teardown via the `finally` at L269-272. But `new Bun.WebView({...})` is evaluated at L212-221, BEFORE the `try` is entered, so any throw there skips `stopServer?.()` entirely.

The constructor throws in exactly the situations this script is built for. Per Bun's WebView docs: 'If Bun finds none, the constructor throws' (no Chrome/Chromium/Edge/Brave on PATH or in standard locations) — which is the non-darwin path that CHROME_BACKEND at L19 exists to support (CI, Docker, the repo's dev container). It also throws on out-of-range dimensions: `width`/`height` must be 1-16384, while `toNumber()` at L77-87 validates only `Number.isFinite`, so `--w -5`, `--w 0`, or `--w 1e6` pass the CLI check and reach the constructor unclamped. (The server-side `frameSize()` in src/shot/registry.ts clamps to 64..4096, but that clamp never applies to the WebView argument.)

Because Bun documents that 'the parent bun process does not terminate until all child processes have exited', the outcome is one of two bad ones: the script hangs forever holding a live dev server, or it exits on the unhandled rejection and leaves an orphaned dev server still bound to its port. Every failed invocation leaks another one — the accumulating `bun run` process tree CLAUDE.md already warns about. The thrown error is also the least informative one possible, because the dev server's stderr was piped and discarded (see the separate finding).

## Recommendation

Move `new Bun.WebView(...)` inside the `try`, or register teardown immediately after `startDevServer()` resolves (e.g. `try { ... } finally { stopServer?.() }` wrapping everything after the spawn, or `await using` for the view). Separately, validate `--w`/`--h` as positive integers within 1..16384 in `toNumber()` so a typo fails with a usage error instead of a half-torn-down run, and consider clamping client-side with the same bounds registry.ts uses so the frame check can't be tripped by the script's own input handling.

## Revalidation

**Verdict:** true-positive

Confirmed by reading the control flow: `startDevServer()` spawns `bun run dev` at L111-117 and `stopServer` is assigned at L201, but the only teardown is the `finally` at L269-272 attached to the `try` that opens at L223 — while `new Bun.WebView({...})` is evaluated at L212-221, before that `try`. Any throw from the constructor therefore skips `stopServer?.()` entirely while the dev server is already running. The constructor does throw in exactly this script's target environments: Bun's WebView docs state 'If Bun finds none, the constructor throws' when no Chrome/Chromium/Edge/Brave is on PATH or in a standard location, and that is the non-darwin path `CHROME_BACKEND` at L19 exists to serve (CI, Docker, the repo's dev container); the same page also documents throws for `backend: "webkit"` off macOS, for construction inside a Worker, and for `headless: false`. The dimension sub-claim is weaker than stated — the docs give `width`/`height` as 'Range 1-16384' for the constructor without explicitly saying it throws out of range (only `resize()` is phrased as a hard requirement) — but `toNumber()` at L77-87 really does validate only `Number.isFinite`, so `--w -5`, `--w 0` and `--w 1e6` all reach the constructor unclamped, and `frameSize()` in src/shot/registry.ts clamps the server side only, never the WebView argument. The consequence is confirmed from Bun's own spawn docs (/docs/runtime/child-process): 'The parent bun process does not terminate until all child processes have exited. Use proc.unref() to detach' — so the outcome is either a permanent hang holding a live dev server, or (if the unhandled rejection hard-exits) an orphaned `bun run dev` tree still bound to its port, accumulating one more on every failed invocation. Compounding it, the thrown error is maximally uninformative because the server's stderr was piped and discarded (F8). The fix is straightforward: move the construction inside the `try`, or register teardown immediately after `startDevServer()` resolves.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
- Stanislav <stanislav.khromov@gmail.com> (2026-08-22)
