# [BUG] Virtual module's `default` export exposes the unproxied `Mochi`, bypassing the capturing serve() stub

**File:** [`packages/mochi/src/cli/extractServeOptions.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/extractServeOptions.ts#L68-L70) (lines 68, 70)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The virtual module sets `default: (realMod as { default?: unknown }).default ?? realMod` (L68). `packages/mochi/src/index.ts` has no `export default`, so `realMod.default` is always `undefined` and `default` resolves to the raw namespace object — whose `.Mochi` is the real, unproxied class, not `mochiProxy`. Only the explicitly overridden `Mochi:` key (L70) carries the stub. An entry reaching `serve` through the default binding (`import mochi from 'mochi-framework'; await mochi.Mochi.serve({...})`) therefore calls the *real* `serve()` during extraction: `Mochi.serve` itself has no `isBuilding` guard (only `queue.ts` consults `isBuildingEntry()`), so it binds a real port. Under `mochi-framework build` the entry then continues past the call, `captured` stays `null`, and `cli.ts:215` reports the misleading 'No `routes` found. Ensure <entry> calls Mochi.serve({ routes }).'; under the dev watcher it would attempt to bind the port the running server already holds. This is latent rather than practically triggerable — the same default import resolves to `undefined` against the real ESM module, so such an entry is already broken outside extraction — but it defeats the invariant the file's own docblock states ('replacing `Mochi.serve` with a stub').

## Recommendation

Build the exports object once and point `default` at the same proxied shape rather than the raw namespace, e.g. `const exports = { ...realMod, Mochi: mochiProxy, isBuilding: true }; return { loader: 'object', exports: { ...exports, default: exports } }`, so no reachable binding hands out the unproxied `Mochi`.

## Revalidation

**Verdict:** true-positive

Mechanically confirmed, and genuinely latent — I'd treat it as the lowest-priority item here. `packages/mochi/src/index.ts` has no `export default` (grep returns nothing), so `(realMod as {default?: unknown}).default` is `undefined` and L68 resolves `default` to the raw namespace object, whose `.Mochi` is the real class; only the explicit `Mochi:` key at L70 carries `mochiProxy`. I also confirmed the downstream premise rather than assuming it: `Mochi.serve` consults no build flag — a repo-wide grep shows `isBuildingEntry()` is read only by queue.ts (L934, L1024-1052, L1143) — so a `serve()` reached via the default binding really would bind a port mid-extraction, leaving `captured === null` and producing cli.ts L215's misleading 'No `routes` found' message (or, under the dev watcher, a bind against the port the live server holds). What caps this is the finding's own caveat, which I verified empirically: Bun 1.4.5 throws `SyntaxError: Missing 'default' export in module …` for a default import of a default-less ESM module, so an entry written as `import mochi from 'mochi-framework'` cannot boot under `bun run src/index.ts` at all. The only reachable manifestation is therefore `mochi-framework build` against an entry that is already invalid — a confusing error in place of the real SyntaxError — and nothing in the framework or the bundler emits a default import of the specifier (`format: 'esm'`/`target: 'bun'` preserves named imports; no CJS interop shim is in play). So: the defect is real and the docblock's stated invariant ('replacing `Mochi.serve` with a stub') is genuinely broken, but there is no scenario in which a working project is harmed. The one-line fix in the recommendation — build the exports object once and point `default` at the same proxied shape — is worth taking for the invariant alone.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
