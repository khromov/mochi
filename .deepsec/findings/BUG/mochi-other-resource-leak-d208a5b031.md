# [BUG] Module-scope WeakMap loses interval handles across dev hot-reload, leaking a 1s timer per pre-reload socket

**File:** [`packages/site/src/demos/streams/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/streams/routes.ts#L7-L19) (lines 7, 14, 18, 19)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-resource-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `intervals` WeakMap is created inside an IIFE at module scope, so it is owned by that particular module evaluation. On dev hot-reload, `devWatcher.ts:518` does `wsHandlersMap.set(pattern, handler.handlers)` against the handlers from a freshly re-imported module — which carries a brand-new, empty `intervals` WeakMap and new closures.

Sockets opened before the reload stored their handle in the *old* WeakMap. When one of them closes, the framework dispatches to the *new* handler object (`wsHandlersMap.get(ws.data.__mochiRoutePattern)?.close?.(ws)`, Mochi.ts:2006), whose WeakMap has no entry for that `ws`. `clearInterval(intervals.get(ws))` becomes `clearInterval(undefined)` — a silent no-op. The orphaned interval then runs `ws.send(...)` against a closed socket once a second for the remaining life of the process, and because the timer closure holds a strong reference to `ws`, neither the timer nor the socket object can ever be collected. Each edit-reload cycle with an open demo tab adds another permanently-spinning timer.

The `ws` object identity itself is fine — I verified the framework passes Bun's `ServerWebSocket` straight through to `open`/`close` without wrapping, so the WeakMap is correct in the steady state. Only the reload boundary breaks it. Dev-only, which is why this is a BUG rather than a security issue.

## Recommendation

Hang the interval handle off the socket's own lifetime instead of a module-scoped map — either stash it on `ws.data.user` via a `Mochi.ws({ upgrade })` handler, or pin the map on `globalThis` with `pinGlobal()` so it survives re-evaluation (the same pattern `lib/highlight.server.ts` already uses for exactly this reason).

## Revalidation

**Verdict:** true-positive

Confirmed in full. `intervals` is a `WeakMap` created inside the IIFE at routes.ts:7, so it belongs to one module evaluation. On a dev reload, devWatcher rebuilds the entry and calls `extractServeOptions(outFile, { fresh: true })` (devWatcher.ts:340), re-evaluating the whole first-party graph — a brand-new empty WeakMap and new closures — then hot-swaps via `wsHandlersMap.set(pattern, handler.handlers)` (devWatcher.ts:517). Mochi's Bun `close` handler reads the live map at dispatch time: `wsHandlersMap.get(ws.data.__mochiRoutePattern)?.close?.(ws, code, reason)` (Mochi.ts:2004), so a socket opened before the reload — whose handle lives only in the discarded WeakMap — hits `clearInterval(intervals.get(ws))` with `undefined`, a silent no-op. I also verified the framework passes Bun's `ServerWebSocket` straight through to `open`/`close` without wrapping, so the WeakMap keying is correct in the steady state and only the reload boundary breaks it, exactly as the finding states. The orphaned interval's closure holds `ws` strongly, so neither the timer nor the socket can be collected, and it keeps calling `ws.send` on a dead socket once a second for the life of the process. This fires on essentially every save with the demo tab open, because `applyRouteChanges` swaps the handlers before the browser is told to reload and close its socket. Notably the framework documents this exact hazard class — packages/docs/170-development-mode.md warns that each reload re-creates module-scoped singletons holding an OS resource (it names `setInterval` specifically) and prescribes `pinGlobal`, with a `recompile:module-churn` event firing after ten reloads — so this demo simply does not follow the project's own guidance. Dev-only, self-limited to one dev session, hence BUG; the recommended fixes (stash the handle on `ws.data.user` via an `upgrade` handler, or `pinGlobal` the map as lib/highlight.server.ts does) are both correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
