# [BUG] Entry HMR re-applies routes, cron, image and speculation rules but silently ignores handle/csrf/protection/rateLimit/proxy changes

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L314-L390) (lines 314, 347, 350, 390)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`buildEntry` re-extracts the entry's serve options and reapplies exactly four of them: `speculationRules` (L347), `cron` (L348), `image` (L349) and `routes` (L350-360). Everything else in the freshly captured `MochiServeOptions` is dropped on the floor, while the running server keeps the boot-time closures: `middleware = options.handle` (Mochi.ts:505) is captured by `composedFetch` and by every page/api route closure (Mochi.ts:991, :1240, :1922), and `csrf`, `protection`, the global `rateLimit`, `proxy`, `trailingSlash` and `cookieDefaults` are likewise pinned at boot inside `makeRequestContextBuilder`.

Unlike the image path — which explicitly warns "restart the dev server to apply it" for its boot-only fields (L390-400) — nothing tells the developer. The save succeeds, the browser reloads, the HMR line reports a successful rebuild, and the new configuration is simply not running. This matters most for `handle`, because that is where applications put authentication: `packages/support` gates every `/admin*` path through `sequence(adminAuth)`. A developer editing auth middleware in dev is testing the previous version of their auth chain while being told the reload succeeded — the failure mode is believing a security fix is live when it is not (or that a newly added gate is enforced when it is not).

## Recommendation

Mirror the `reloadImage` pattern: diff the newly captured options against the boot-time ones for the keys that cannot be hot-swapped (`handle`, `csrf`, `protection`, `rateLimit`, `proxy`, `trailingSlash`, `publicDir`, `htmlShell` mode) and log a single `restart the dev server to apply <key>` warning when one changes — or make `handle` live by reading it through a mutable getter the way `shellTemplate` and `speculationRules` already are. Document the boot-only set in `170-development-mode.md`.

## Revalidation

**Verdict:** true-positive

Verified by enumerating every consumer. `buildEntry` (devWatcher.ts:342-360) re-extracts the full `MochiServeOptions` and reapplies exactly four fields — `speculationRules` (347), `cron` (348), `image` (349) and `routes` (350-360) — discarding the rest. On the server side `const middleware = options.handle` is captured once at Mochi.ts:505 and is the only reference used by the page closure (991), the api closure (1240) and `composedFetch` (1922); `makeRequestContextBuilder` is likewise constructed once (772-784) with `proxy`, `csrf`, `trailingSlashPolicy`, `cookieDefaults`, `development`, `debugBarEnabled` and the protection gate frozen in, and `composedFetch` reads `options.csrf`/`options.proxy` off the boot options object (1865). A re-imported entry produces a brand-new options literal, so none of those can change — contrast `shellTemplate` and `speculationRules`, which are deliberately read through mutable getters/setters. The silence is also real: with only `handle` edited, `counts` stays all-zero so no 'Entry rebuilt' line prints, yet the file change still emits `recompile:complete`, so `consoleLogger` prints an 'HMR src/index.ts … rebuilt 0 pages' line that reads as a successful reload. The security-adjacent failure mode the finding highlights is the right one to call out — `packages/support` gates every `/admin*` path through `sequence(adminAuth)` in `handle`, so a developer iterating on that chain is testing the pre-edit version while being told the reload succeeded. Not itself exploitable, so BUG is the correct severity; mirroring the `reloadImage` warning for the boot-only key set is the proportionate fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
