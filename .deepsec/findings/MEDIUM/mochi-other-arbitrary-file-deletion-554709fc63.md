# [MEDIUM] Canonicalised out-dir turns a symlink in the project into a recursive delete outside it

**File:** [`packages/mochi/src/cli/build.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/build.ts#L105-L112) (lines 105, 112)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-arbitrary-file-deletion`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`build()` resolves the out-dir through `resolveOutDir()` (L105), which canonicalises symlinks via `realpathSync`, and then unconditionally runs `rmSync(outDir, { recursive: true, force: true })` (L112) with no check that the directory is inside the project or was produced by a previous build.

Without canonicalisation this would be harmless: `fs.rm`/`fs.rmSync` lstats its argument and *unlinks* a symlink rather than recursing into its target. Because `resolveOutDir()` replaces the symlinked spelling with the real path before the delete, `rmSync` receives the target directory itself and recursively force-deletes its contents. `resolveOutDir` was added for a legitimate reason (Bun's resolver caches artifacts under real paths — see `buildSymlinkedOutDir.test.ts`), but the safety consequence at this call site was not accounted for.

Attack scenario: Git preserves symlinks on checkout. A repository (or a PR to a repo whose CI runs a build step) contains a committed symlink `.mochi -> /home/runner/.ssh` (or `-> $HOME`, or any existing absolute path). No flags are needed — `.mochi` is the default out-dir. Any developer or CI job that runs `mochi-framework build` resolves `.mochi` to the real target and recursively deletes it, before the public-dir scan or any compilation happens. A dangling symlink is safe (realpathSync throws ENOENT and the uncanonicalised path is returned, so only the link is unlinked), but one pointing at an existing directory destroys it.

Partial mitigation worth stating plainly: `mochi-framework build` already imports the user's entry via `extractServeOptions`, so an adversary who can add arbitrary *code* to the repo has execution anyway. The residual value is against adversaries who can write only non-code files (a shared CI workspace, a writable build directory) and against code review — a symlink renders as a one-line diff and is far easier to miss than malicious code in `src/index.ts`. `Mochi.ts:600` shares the pattern, but is dev-only and targets the nested `<outDir>/dev`.

## Recommendation

Before deleting, require the resolved out-dir to be contained in the project root (`path.relative(projectRoot, outDir)` must not escape) and refuse when the path, or any ancestor segment, is a symlink — `lstatSync(outDir).isSymbolicLink()` should be an error, not silently followed. Alternatively keep canonicalisation for resolution but delete through the *uncanonicalised* path, and only remove a directory that contains a build marker (e.g. a previous `manifest.json`), falling back to creating the directory when it holds anything else.

## Revalidation

**Verdict:** true-positive

Mechanism fully confirmed. `resolveOutDir` (compiler/resolveOutDir.ts) canonicalises via `realpathSync`, returning the *target* of a leaf symlink; build.ts L105 feeds that into the unguarded `rmSync(outDir, { recursive: true, force: true })` at L112 with no containment, lstat or build-marker check anywhere in the path (I read `checkEnvironment()` and cli.ts — nothing validates the out-dir). I verified the causal attribution empirically rather than assuming it: `fs.rmSync(<dirSymlink>, {recursive:true, force:true})` under Bun 1.4.5 unlinks the link and leaves the target fully intact, so without canonicalisation this really is harmless, and commit 0f4dadb6 (#366, 'canonicalise the out-dir so a symlinked path doesn't break island resolution') is what converted a link-unlink into a recursive delete of the target. The dangling-symlink carve-out is also right: `realpathSync` throws ENOENT, the loop reconstructs the uncanonicalised `<proj>/.mochi`, and only the link dies. Reachability holds: `.mochi` is the default out-dir, git checks out a tracked symlink regardless of `.gitignore` (the repo ignores `.mochi`, but `git add -f` makes it tracked and checkout materialises it), and a production build reaches L112 with `outDir === baseOutDir`. I agree with the finding's own honesty about the ceiling — `extractServeOptions` imports the entry first, so a code-capable adversary already has execution, and the residual value is against write-but-not-code adversaries (shared CI workspaces) and against code review, where a symlink is a one-line diff. The Mochi.ts:600 comparison is also correct: it is `development`-gated and targets the nested `<outDir>/dev`, whose leaf is not canonicalised. MEDIUM is the right band. Overlaps F2 at the same line but is a distinct issue: different trigger (attacker-planted symlink vs. operator-named path), different threat actor, and a different fix (containment + lstat refusal does not stop `--out-dir .`, which is inside the root).

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
