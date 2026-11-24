# [BUG] chokidar watchers are never closed, so Mochi.stop() cannot let a dev-mode process exit

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L693-L826) (lines 693, 810, 826)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`startDevWatcher` creates two chokidar watchers (L693 over the source tree/public dir, L810 over `svelte.config.js`) and returns only a readiness promise — it exposes no dispose handle, and nothing ever calls `.close()` on either (no `close`/`unwatch` call exists in the file or in `Mochi.ts`).

The subsystem teardown wrapper installed on `server.stop` (Mochi.ts:2032-2065) carefully stops the image sweeper, the memory-pressure handler, the cron runtime, the email-badge subscription, the email transport and every rate-limit store — but not the watchers, which are started afterwards. `runShutdown` (Mochi.ts:2236-2275) does not either. The signal path papers over this by force-exiting, and its comment names the cause: "chokidar's dev watchers and any user timer still running would otherwise keep the event loop alive past the last socket" (Mochi.ts:2213); `utils/shutdownSignalServer.ts:15` repeats it ("Dev mode is the case that hangs in practice: it starts chokidar watchers that outlive the last socket").

`Mochi.stop()` has no such escape hatch, and its contract is explicitly the opposite: "Gracefully stop everything Mochi is running ... without exiting the process, so a finite-lifetime embedder (script, test) can end naturally instead of signalling itself." In development that promise is broken — the process hangs on live fs watchers, and those orphans keep firing: file changes still run `registry.recompileChanged()`, `server.reload()` and `notifyClients()` against a stopped server, pinning the registry, the compiled module graph and the entry-HMR artifacts in memory.

## Recommendation

Return a disposer from `startDevWatcher` (`await Promise.all([watcher.close(), svelteConfigWatcher.close()])`, plus cancelling the debounced closures), store it next to the other subsystem handles, and invoke it from the `server.stop` cleanup wrapper so both `Mochi.stop()` and the signal path tear the watchers down instead of relying on `process.exit`.

## Revalidation

**Verdict:** true-positive

Verified mechanically and corroborated by the project's own notes. `startDevWatcher` creates `chokidar.watch(finalWatchPaths, …)` at L693 and `chokidar.watch(svelteConfigPath, …)` at L810 and returns only `watcherReady` (L826) — no dispose handle — and `grep '\.close()\|unwatch'` across all of `packages/mochi/src` returns nothing, so neither watcher is ever closed anywhere in the framework. The teardown wrapper on `server.stop` (Mochi.ts:2032-2067) stops the image sweeper, memory-pressure handler, cron runtime, email-badge subscription, email transport and every rate-limit store, but it is installed at 2032 while `startDevWatcher` is not called until 2152, and `runShutdown` (2236-2275) adds nothing. The signal path escapes only by force-exiting, and its comment names the exact cause ('chokidar's dev watchers … would otherwise keep the event loop alive past the last socket', Mochi.ts:2213); `utils/shutdownSignalServer.ts:15` independently confirms it from the project's own test harness ('Dev mode is the case that hangs in practice: it starts chokidar watchers that outlive the last socket'). `Mochi.stop()` → `performShutdown()` → `runShutdown()` never calls `process.exit`, and its JSDoc at 2188-2191 explicitly promises to stop 'without exiting the process, so a finite-lifetime embedder (script, test) can end naturally' — a promise the dev path cannot keep. The secondary claim is also sound: the surviving watchers keep invoking `recompileChanged`/`server.reload`/`notifyClients` against a stopped server, pinning the registry and compiled module graph. Not a security issue; correctly filed as BUG, and returning a disposer wired into the stop wrapper is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
