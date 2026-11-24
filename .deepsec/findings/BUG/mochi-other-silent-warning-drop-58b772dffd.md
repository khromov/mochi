# [BUG] `scanComponentExports` warnings are computed and then discarded, so unstubbed `export *` in a `.server.svelte` module script is silent

**File:** [`packages/mochi/src/compiler/serverOnlyComponents.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/serverOnlyComponents.ts#L23-L55) (lines 23, 29, 50, 55)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-silent-warning-drop`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`scanComponentExports` returns `{ ...scan, hasDefault: true }` (L23) and therefore carries `scan.warnings` out of `scanServerOnlyExports`, but the `onLoad` that consumes it (L50-57) passes the whole object straight into `buildServerOnlyStubModule` and never reads `.warnings`. The `.server.ts` path does log them (`ComponentRegistry.ts:1365-1367` iterates `scan.warnings` through `logger.warn`), so the two halves of the same mechanism behave differently.

Concretely: a `.server.svelte` whose `<script module>` contains `export * from './x'` or `export { y as "weird-name" }` produces a stub missing those names, and the diagnostic explaining why — the whole reason `serverOnlyScan.ts:32` and `:22` build those strings — is thrown away. The developer gets either Bun's opaque "No matching export in ..." build failure or, for a namespace import (`import * as all from './C.server.svelte'`), a silent `undefined` where a throwing stub was expected. The parse-failure fallback on L29 also hard-codes `warnings: []`, hiding the same information.

## Recommendation

Thread a logger into `registerServerOnlyComponentStubs` (or have it return the warnings) and emit them the same way `ComponentRegistry.ts:1365-1367` does for `.server.ts`: `for (const w of scan.warnings) logger.warn(`[mochi] ${relForDisplay(args.path)}: ${w}`)`. Add a test asserting an `export *` in a `.server.svelte` module script produces a warning.

## Revalidation

**Verdict:** true-positive

Confirmed by direct reading of both halves of the mechanism. `scanComponentExports` (serverOnlyComponents.ts:17-30) returns `{ ...scan, hasDefault: true }`, so `scan.warnings` produced by `scanServerOnlyExports` flows out intact; the consuming onLoad at L50-57 passes the whole object into `buildServerOnlyStubModule` and never touches `.warnings`, and there is no logger imported into the file at all. The `.server.ts` twin does log them — ComponentRegistry.ts:1365-1367 iterates `scan.warnings` through `logger.warn` — so the two arms of one mechanism genuinely behave differently. I also confirmed both warning sources are reachable for a `.server.svelte`: serverOnlyScan.ts:32 pushes the `export *` warning from the sliced `<script module>` source, and serverOnlyScan.ts:22 pushes the string-named-export warning, which serverOnlyScan.test.ts:158-165 proves `Bun.Transpiler.scan()` actually surfaces (`export { x as "weird-name" }` → warning). The parse-failure fallback at L29 does hard-code `warnings: []`, so the same information is dropped there too. Consequence is exactly as stated: a missing stub export surfaces as Bun's opaque "No matching export" build failure, or as a silent `undefined` for a namespace import, with the explanatory diagnostic discarded. Not a security issue — a developer-experience/observability bug — so BUG is the right severity.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-08)
