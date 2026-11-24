# [BUG] Hardcoded `tailwind-rebuild` handler name makes a second setupTailwind() call silently disable the first stylesheet's dev watcher

**File:** [`packages/mochi/src/compiler/tailwind.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/tailwind.ts#L65-L90) (lines 65, 90)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`setupTailwind` registers its rebuild subscription under the constant name `'tailwind-rebuild'`. `mochiEvents.setHandler` is documented (events.ts:486) as replacing "any handler previously registered under that name across any event type", and its docstring explicitly warns to namespace the name because "two callers picking the same name silently evict each other". Because the name is not derived from `opts`, calling `setupTailwind` twice — the natural way to drive two Tailwind entry points — makes the second call evict the first call's handler via the `base.off(prior.type, prior.handler)` path in events.ts:498-509.

Result: only the last-registered stylesheet rebuilds in dev. The earlier one is compiled once at startup (line 67 still runs) and then goes permanently stale, so edits to its classes produce no CSS update. The eviction is silent — no error, no warning — and `compileTailwind` is already exported separately for the no-watcher case, so the watcher is the *only* reason to call `setupTailwind` at all; losing it defeats the function's entire purpose.

This is a plausible configuration, not a hypothetical: the docs nudge toward multiple scoped stylesheets ("On a multi-page site, scope your Tailwind CSS to a single page", 175-tailwind.md:159), and the in-repo call site already mounts Tailwind from a per-feature route module (`packages/demos/src/todo/routes.ts:10`) — a pattern that breaks as soon as a second feature folder does the same.

The framework's own convention confirms the intended shape: `ImageCache` builds a per-instance name `mochi-image:cache-delete:${++cascadeSeq}` (imageCache.ts:182) and releases it with `removeHandler` in `dispose()` (imageCache.ts:196). `setupTailwind` does neither, so it also never unsubscribes — the handler and its captured `opts` outlive a `Mochi.stop()`.

Not a security issue: `file:change` is emitted only by the dev watcher, which `Mochi.ts:2151` gates behind `if (development)`, so nothing here is reachable in production or by a remote request.

## Recommendation

Derive the handler name per call instead of hardcoding it — e.g. `const handlerName = \`mochi-tailwind:rebuild:${outputAbs}\`` (or a module-level `++tailwindSeq` counter, mirroring `cascadeSeq` in imageCache.ts) — so concurrent stylesheets coexist while a dev re-import of the same config still replaces rather than stacks. Additionally, return a disposer (or accept an `AbortSignal`) that calls `mochiEvents.removeHandler(handlerName)` and clears any `pending` timeout, matching the `ImageCache.dispose()` pattern, so a teardown releases the subscription.

## Revalidation

**Verdict:** true-positive

Every link in this chain is confirmed in source. `setupTailwind` (tailwind.ts:90) hardcodes `mochiEvents.setHandler('tailwind-rebuild', 'file:change', …)` with a name that does not depend on `opts`. The emitter's `setHandler` (events.ts:498-509) looks up `byName.get(name)` and calls `base.off(prior.type, prior.handler)` before re-registering — exactly the eviction described — and its own docstring (lines 479-484) warns to namespace the name 'since two callers picking the same name silently evict each other'. So a second `setupTailwind` call removes the first call's `file:change` subscriber. The first stylesheet still gets its one-shot `compileTailwind(opts)` at line 67, then goes permanently stale with no error and no warning; since `compileTailwind` is exported separately for the no-watcher case, the watcher is the only reason to call `setupTailwind` at all. The framework's own convention confirms the intended shape: `ImageCache` builds a per-instance `mochi-image:cache-delete:${++cascadeSeq}` (imageCache.ts:130,182) and releases it via `removeHandler` in `dispose()` (line 196). `setupTailwind` returns `void` with no disposer, and I grepped Mochi.ts and devWatcher.ts for `mochiEvents.off` / `all.clear()` / `removeHandler` — none exist, so the handler and its captured `opts` do outlive teardown. The no-security-impact reasoning also holds: `file:change` is emitted only at devWatcher.ts:750, and `startDevWatcher` is gated behind `if (development)` at Mochi.ts:2151. Two caveats that weaken the argument without changing the verdict. First, the cited doc line (175-tailwind.md:159, 'scope your Tailwind CSS to a single page') is about which page imports the generated stylesheet, not about calling `setupTailwind` twice — the docs only ever show one call — so the 'docs nudge toward multiple scoped stylesheets' framing is a stretch. The stronger evidence is the real call site: `packages/demos/src/todo/routes.ts:8-15` mounts Tailwind from a per-feature route module, a pattern that silently breaks the moment a second feature folder copies it. Second, the finding's alternative fix (a module-level `++tailwindSeq` counter) is wrong — it would reintroduce handler stacking across the dev entry re-import that the hardcoded name exists to collapse (see the line-64 docstring and `freshImport(entryPath)` in cli/extractServeOptions.ts:87). Only the primary suggestion, deriving the name from `outputAbs`, satisfies both constraints.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
