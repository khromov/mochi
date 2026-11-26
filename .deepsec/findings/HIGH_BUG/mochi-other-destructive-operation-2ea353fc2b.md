# [HIGH_BUG] `--out-dir` recursively force-deletes any directory it names, including the project root

**File:** [`packages/mochi/src/cli/build.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/build.ts#L112) (lines 112)
**Project:** mochi
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-destructive-operation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L112 runs `rmSync(outDir, { recursive: true, force: true })` on a path that comes straight from the `--out-dir` CLI flag (cli.ts L231 → `resolveOutDir(options.outDir ?? './.mochi')`) with no validation whatsoever. The delete is the *first* thing the build does — before the public-dir collision scan, before `loadSvelteConfig`, before any compilation — so a build that would have failed a second later still destroys the directory first.

Concrete failure scenarios:
- `mochi-framework build --out-dir .` → `rmSync` on the resolved cwd recursively deletes the entire project, including `src/`, `.git` and uncommitted work, then recreates it with three empty `svelte-*` subdirectories.
- `--out-dir ./public` → deletes every static asset. Because the build only *scans* `publicDir` and never copies it, the run then reports `0 public file(s)` and completes successfully, so the loss surfaces later as a deploy with no assets.
- `--out-dir ..` or `--out-dir ./src` → same class of loss.

The CLI's contract (`--out-dir <path>  Build output directory`) gives a user no reason to expect that pointing it at an existing directory is destructive, and comparable tools guard this: Vite refuses to empty an `outDir` outside the project root without an explicit opt-in. There is no confirmation prompt, no `--force`, and no dry run.

## Recommendation

Guard the delete: resolve the out-dir, reject it when it is the cwd/project root or an ancestor of either, and otherwise only wipe a directory that looks like a Mochi build output (contains `manifest.json` or a dedicated marker file written by a prior build) — for anything else, error out with a message naming the path instead of deleting. Cheaper interim fix: delete only the known subtrees (`svelte-compile`, `svelte-client`, `svelte-css`, `assets`, `manifest.json`, `server-island.js`) rather than the whole directory.

## Revalidation

**Verdict:** true-positive

Confirmed by reading the whole chain. cli.ts declares `'out-dir': { type: 'string' }` (L143) and passes `values['out-dir']` straight through (L231) with no validation; build.ts L105 resolves it and L112 runs `rmSync(outDir, { recursive: true, force: true })`. I traced ordering inside `build()`: only `checkEnvironment()`, log setup and `readMochiVersion()` precede it — the delete lands before `scanPublicDir`, before `loadSvelteConfig`, and before any compile, so the 'destroys first, fails second' claim is exact. `--out-dir .` → `resolveOutDir('.')` is the real cwd → recursive force-delete of `src/`, `.git` and uncommitted work, then `mkdirSync` recreates the directory with three empty `svelte-*` children; the subsequent `compileAll` then fails on the now-deleted component paths it captured from the entry before the wipe. The `./public` scenario is worse than it looks for the same reason I verified in build.ts: the build only *scans* publicDir (L126-127, 'Scanned, never copied' per docs/183-cli.md) and the scan runs *after* the delete, so the run reports `0 public file(s)` and exits 0 — silent asset loss that surfaces at deploy. Nothing in docs/183-cli.md warns about this ('Base build output directory'), there is no `--force`, no prompt and no dry run, and `checkEnvironment()` validates only Bun/Svelte versions. The comparison to guarded tools is fair in substance (Vite's `emptyDir` carries a skip list that spares `.git`). No attacker is required, so this is correctly a bug rather than a security issue, but 'repo including .git deleted with no confirmation from a flag documented as an output directory' sits at the high end of bug severity. Kept separate from F1 rather than merged: same line, but the trigger, actor and required guard differ.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
