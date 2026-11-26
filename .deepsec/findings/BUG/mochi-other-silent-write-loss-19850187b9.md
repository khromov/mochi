# [BUG] Request-context proxies have no `set` trap, so assignments silently write to a dead target and vanish

**File:** [`packages/mochi/src/compiler/virtual-modules/mochi-env.server.js`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/virtual-modules/mochi-env.server.js#L9-L28) (lines 9, 10, 25, 28)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-silent-write-loss`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`__mochiCtxProxy(key)` builds its proxies over an empty object literal and traps `get`, `has`, `ownKeys` and `getOwnPropertyDescriptor` — every read is forwarded to `getRequestContext()[key]` and the target is never consulted. But there is no `set` trap, so assignment falls through to the default behaviour and writes onto the throwaway `{}`.

The result is a silent write/read split across the four exported bindings (`cookies`, `params`, `url`, `locals`): `locals.user = { id: 1 }` stores the value on the dummy target, while the very next `locals.user` goes through the `get` trap to the real `ctx.locals` and returns `undefined`. The write is lost with no error, in a server context where strict mode would otherwise have surfaced a rejected assignment.

This is most likely to bite on `locals`, the one mutable member of the set. The documented write path is middleware mutating `event.locals` directly (`packages/docs/120-middleware.md:47`, `packages/docs/85-request-context.md:85`), which touches the real object and is unaffected; but `locals` is also exported as a direct import for components (`packages/docs/85-request-context.md:17,93-95`), and nothing in the API shape signals that it is read-only there. A component or `.svelte.ts` module that sets a flag on `locals` for later middleware or a `transformPage` hook to read will find it absent.

That the client module guards exactly this case for `url` — `set() { return false; }` on lines 30 of `mochi-env.client.js`, which throws a TypeError in strict-mode ESM — is good evidence the server omission is an oversight rather than an intentional allowance. The client's `cookies` proxy (lines 14-20 there) shares the same gap.

## Recommendation

Add a `set` trap to `__mochiCtxProxy` that forwards to the real object for `locals` (`Reflect.set(getRequestContext()[key], p, v)`) and rejects for the genuinely read-only `params`/`url`/`cookies` — either `return false` (TypeError under strict mode, matching the client's `url` proxy) or an explicit throw naming the binding. Add the same `set` trap to the client `cookies` proxy, and add a test asserting that a write to `locals` is observable through a subsequent read.

## Revalidation

**Verdict:** true-positive

Confirmed by spec-level trace. `__mochiCtxProxy` (mochi-env.server.js:9-23) builds `new Proxy({}, …)` with `get`/`has`/`ownKeys`/`getOwnPropertyDescriptor` traps that all forward to `getRequestContext()[key]`; the target is never read. With no `set` trap, `proxy.p = v` runs OrdinarySet on the throwaway `{}`: ownDesc is undefined, so it walks to `Object.prototype`, lands on a default writable descriptor, then does `CreateDataProperty(Receiver=proxy, …)` → no `defineProperty` trap → the value is written to the dummy. The next read goes through `get` to the real context and returns the old/undefined value. Write silently lost, confirmed. Reachability is narrower than the finding implies in one way and broader in another: `index.ts` does NOT export `locals`/`params`/`url`/`cookies` at all (I enumerated its exports), so these bindings exist only inside compiled code — but `registerMochiEnvClient`/the server equivalent resolve bare `mochi-framework` for every module in the bundle graph, so `.svelte`, `.svelte.ts` and plain `.ts` files in that graph are all affected. `mochi-framework.d.ts:51` types `locals` as a mutable `Record<string, unknown>` (vs. `params`'s `Readonly<…>`), so a component write type-checks and fails only at runtime, which is precisely the silent-failure shape described. The client `url` proxy's `set() { return false }` (mochi-env.client.js:30) corroborates the omission. One consequence the finding missed strengthens it: when the real context already owns the key, OrdinarySet takes the `existingDescriptor` branch and calls `Reflect.defineProperty(target, p, { value })`, creating a **non-configurable** property on the module-lifetime dummy. On a later request where the context lacks that key, the `ownKeys`/`getOwnPropertyDescriptor` traps then violate proxy invariants and throw a `TypeError` on `Object.keys(locals)`, `{...locals}` or `Object.entries(locals)` — cross-request state pollution in a long-lived process. BUG severity is correct; this is a correctness defect, not a security boundary.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-13)
