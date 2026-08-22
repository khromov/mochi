---
name: update-vendored
description: Check whether the scripts vendored under packages/mochi/src/vendor/ are on the latest upstream release, and update the ones that aren't. Use when the user asks to "check vendored versions", "update vendored scripts", "refresh vendored deps", or "/update-vendored".
user-invocable: true
---

# Update vendored scripts

Every folder under `packages/mochi/src/vendor/` is a copy of a small upstream npm package (see `Dependencies` → `Vendoring` in `/CLAUDE.md`). This skill checks each one against its latest npm release and, for anything behind, replaces it wholesale with the new version's published source.

**Files must be added AS IS from what npm published for that version.** Do not diff the old and new upstream sources and hand-patch changes into the existing vendored file, and do not otherwise edit, refactor, or "fix" the vendored code yourself — that risks silently introducing behavior the upstream package never had. The only permitted mechanical step is re-applying the same file-format treatment already established for that vendor folder (e.g. the `.ts` extension, the ESM/CJS-build merge via the `typeof process !== 'undefined'` runtime switch) so it fits the existing build — never a judgment-based content edit.

## Step 1 — check

```sh
bun run check-vendored-versions
```

This prints, per vendored script: the pinned version (parsed from the `// Vendored from https://github.com/<owner>/<repo> <version>` comment at the top of its `index.ts`) and the latest version on npm. If everything is current, report that and stop — do not proceed to Step 2.

## Step 2 — update each outdated script

For every script where pinned ≠ latest:

1. Note the npm package name (matches the vendor folder name so far in this repo) and the latest version.
2. Download only the latest tarball into the scratchpad dir and extract it:

   ```sh
   cd <scratchpad>
   npm pack <pkg>@<latest-version>
   mkdir new && tar -xzf <pkg>-<latest-version>.tgz -C new --strip-components=1
   ```

3. Take the new version's source file(s) as published — unmodified — and use them to replace `packages/mochi/src/vendor/<name>/index.ts` wholesale, applying only the mechanical treatment described above (extension, ESM/CJS merge if the original vendoring did that). Do not carry forward or hand-merge anything from the old vendored file's content.
4. Bump the version in the `// Vendored from ...` comment to `<latest-version>`.
5. Compare the upstream `LICENSE` (old vs new, as published — not hand-edited) — if the copyright year or contributor list changed, replace `packages/mochi/src/vendor/<name>/LICENSE` with the new one as-is.
6. Remove the downloaded tarball and `new/` extraction dir from the scratchpad.

If the new version doesn't fit the established mechanical treatment (new required peer deps, a different module system, split across more files than before), stop and report it to the user instead of guessing — re-vendoring from scratch is a judgment call for them, not something to push through silently.

## Step 3 — verify

Delegate `bun run checks` to a sub-agent per the repo convention (never run it directly from the main context — its output is too large). Report back only pass/fail and any failures.

## Step 4 — report

Summarize what changed, e.g. `slugify: 1.6.9 → 1.7.0`, list the files touched (`index.ts`, `LICENSE` if applicable), and stop. Per repo convention, never `git commit` on your own — wait for the user to say so.
