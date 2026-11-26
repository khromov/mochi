# [BUG] Extraction's process-global Bun.plugin and captured state are never scoped or cleared, leaking a stub `mochi-framework` namespace into the live dev server

**File:** [`packages/mochi/src/cli/extractServeOptions.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/extractServeOptions.ts#L15-L98) (lines 15, 16, 61, 72, 78, 81, 98)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-global-state-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`extractServeOptions` registers a process-global runtime plugin (L61) that overrides the bare `mochi-framework` specifier, latched by `pluginRegistrationDone` (L78) so it is installed exactly once and never removed. In the build CLI this is harmless (the process exits at `cli.ts:241`), but `dev/devWatcher.ts:342` calls the same function from inside the *running* dev server on every entry rebuild. From the first rebuild onward, the bare specifier is permanently hijacked for the rest of the dev session: any module whose `import ... from 'mochi-framework'` is resolved at runtime after that point receives the virtual namespace instead of the real module — a frozen `isBuilding: true` (L72) rather than the real live binding from `utils/buildFlag.ts`, and a `Mochi` proxy whose `serve` is the capturing stub. Compounding this, `captured` is reset only at the *start* of a call (L81) and never after `return captured` (L98), so it stays non-null for the process lifetime; a `Mochi.serve()` reached through the leaked proxy after a rebuild therefore hits the `captured !== null` branch and throws the misleading 'Mochi.serve() was called more than once while extracting build options' (L49-51) at a moment when no extraction is in progress. The overridden `isBuilding` also silently diverges from `isBuildingEntry()`, which framework internals read through the relative import and which remains correct — so the two disagree. Not a security issue: `startDevWatcher` is gated behind `if (development)` (`Mochi.ts:2151`), so the plugin never reaches a production server, and the spread at L65 keeps every other export real. Reachability is narrow because compiled Svelte never emits a bare `mochi-framework` import (`ComponentRegistry.ts:906` externalizes only `svelte`/`svelte/*` and `mochi-env` shadows the specifier); the exposed paths are lazily-loaded chunks of the `packages: 'external'` entry bundle (`devWatcher.ts:317`) and `freshImportBundled`, which also uses `packages: 'external'`.

## Recommendation

Scope the override to the extraction instead of the process: keep a module-level `extracting` flag that the virtual module's factory consults, so the plugin returns the real namespace (`...realMod` with the genuine `Mochi` and live `isBuilding`) whenever no extraction is in flight. Read `captured` into a local and reset it to `null` in a `finally` before returning, so stale state cannot trigger the 'called more than once' error outside an extraction.

## Revalidation

**Verdict:** true-positive

Every structural claim verified, and reachability is in fact broader than the finding allows. The plugin is latched by `pluginRegistrationDone` (L35/L78) and `Bun.plugin` offers no deregistration, so `build.module('mochi-framework', …)` hijacks that exact specifier for the process lifetime. devWatcher.ts L342 does call `extractServeOptions(outFile, { fresh: true })` from inside a live server, and L314-325 builds the entry with `packages: 'external'`, which leaves `mochi-framework` as a bare runtime specifier in `entry.js` — so from the first rebuild onward the hot-swapped entry graph resolves through the virtual module and sees a frozen `isBuilding: true` (L72) plus `Mochi` as the capturing proxy, while framework internals keep reading the real `isBuildingEntry()` through the relative import (I confirmed buildFlag.ts is only consumed by queue.ts and extractServeOptions; `isBuilding` is a public export at index.ts L59, so app code guarding side effects on it would misbehave in dev after a rebuild). That is a wider blast radius than the 'lazily-loaded chunks and freshImportBundled' framing, not a narrower one, and the rest of the reachability analysis is right: compiled Svelte externalises only `svelte`/`svelte/*` (ComponentRegistry.ts L906) with `mochi-env` shadowing the specifier, so SSR output never emits a bare import. The `captured` claim is also correct — it is nulled only at L81 on entry and never after `return captured` (L98), so it stays non-null between calls and a `Mochi.serve()` reached through the leaked proxy outside an extraction would throw the misleading 'called more than once' error from L49-51. I confirmed the non-security framing: `startDevWatcher` is reached only under `if (development)` (Mochi.ts L2151-2152), so the plugin never lands in a production server, and the L65 spread keeps every other export real. The suggested fix (an `extracting` flag consulted by the module factory, plus resetting `captured` in a `finally`) addresses both halves.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
