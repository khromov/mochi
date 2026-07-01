---
name: update-vendored
description: Check whether the scripts vendored under packages/mochi/src/vendor/ are on the latest upstream release, and update the ones that aren't. Use when the user asks to "check vendored versions", "update vendored scripts", "refresh vendored deps", or "/update-vendored".
user-invocable: true
---

# Update vendored scripts

Every folder under `packages/mochi/src/vendor/` is a hand-adapted, TypeScript-converted copy of a small upstream npm package (see `Dependencies` → `Vendoring` in `/CLAUDE.md`). This skill checks each one against its latest npm release and, for anything behind, merges the upstream delta forward — it does **not** blindly overwrite the vendored file, since that would destroy the TS conversion / ESM merge / other adaptations already applied.

## Step 1 — check

```sh
bun run check-vendored-versions
```

This prints, per vendored script: the pinned version (parsed from the `// Vendored from https://github.com/<owner>/<repo> <version>` comment at the top of its `index.ts`) and the latest version on npm. If everything is current, report that and stop — do not proceed to Step 2.

## Step 2 — update each outdated script

For every script where pinned ≠ latest:

1. Note the npm package name (matches the vendor folder name so far in this repo) and the two versions.
2. Download both tarballs into the scratchpad dir and extract them, so the exact upstream diff is visible:

   ```sh
   cd <scratchpad>
   npm pack <pkg>@<pinned-version> && npm pack <pkg>@<latest-version>
   mkdir old new && tar -xzf <pkg>-<pinned-version>.tgz -C old --strip-components=1
   tar -xzf <pkg>-<latest-version>.tgz -C new --strip-components=1
   diff -ru old new
   ```

3. Read the diff. Apply only the _semantic_ changes it shows to the vendored `packages/mochi/src/vendor/<name>/index.ts` by hand with Edit — keep the existing type annotations, ESM shape, `mochi`-specific tweaks (e.g. the `typeof process !== 'undefined'` runtime switch, dropped `browser` field remaps), and any inline comments already there. Do not paste raw upstream source over the file.
4. Bump the version in the `// Vendored from ...` comment to `<latest-version>`.
5. Diff the upstream `LICENSE` (old vs new) — if the copyright year or contributor list changed, update `packages/mochi/src/vendor/<name>/LICENSE` to match.
6. Remove the downloaded tarballs and `old/`/`new/` extraction dirs from the scratchpad.

If the diff reveals a structural rewrite too large to hand-merge confidently (new required peer deps, dropped/renamed exports, a different module system), stop and report it to the user instead of guessing — re-vendoring from scratch is a judgment call for them, not something to push through silently.

## Step 3 — verify

Delegate `bun run checks` to a sub-agent per the repo convention (never run it directly from the main context — its output is too large). Report back only pass/fail and any failures.

## Step 4 — report

Summarize what changed, e.g. `slugify: 1.6.9 → 1.7.0`, list the files touched (`index.ts`, `LICENSE` if applicable), and stop. Per repo convention, never `git commit` on your own — wait for the user to say so.
