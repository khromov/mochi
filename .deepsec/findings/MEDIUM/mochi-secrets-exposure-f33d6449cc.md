# [MEDIUM] staticDirs mounts serve dotfiles, diverging from the dotfile policy publicDir and Mochi.file both enforce

**File:** [`packages/mochi/src/runtime/staticDirs.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/staticDirs.ts#L36-L57) (lines 36, 39, 43, 46, 57)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `secrets-exposure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`resolveStaticDirs` validates the prefix thoroughly (leading slash, no root mount, no wildcards/params, not inside assetPrefix, no duplicates, directory exists) but applies no content policy, and `registerStaticDirRoutes` hands the directory straight to Bun as a native `{ dir }` route. Bun's directory route rejects non-canonical request paths — segments equal to `.` or `..`, empty segments, `%2F`, ambiguous `%XX` (per its DirectoryRouteOptions contract) — so traversal itself is handled. What it has no notion of is dotfiles: `.env` is an ordinary canonical segment, so `GET /prefix/.env`, `/prefix/.git/config`, or `/prefix/.git/objects/...` is served as-is if those files exist under the mount.

That contradicts the framework's own explicit, twice-implemented policy. `publicDir` filters them at scan time via `isExcludedDotPath()` (runtime/publicDir.ts:14-27, 54-58), allowing only `.well-known`, and `Mochi.file` repeats the identical check with the comment "dotfiles and dot-directories inside the root (`.env`, `.mochi/…`, `.git/…`) are rejected here… matching the public-dir policy" (Mochi.ts:1480-1485). `staticDirs` is the third static-serving mechanism and the only one without it — and it is aimed squarely at the trees most likely to contain them: "a media library, a docs export, a build directory from another tool" (docs/160-serve-options.md:105). Mounting a build output that a tool left an `.env` in, or any directory that is itself a git checkout, publishes those files. The feature is unreleased (`VersionNote since="0.10.0"`) and its docs warning covers only the request-pipeline bypass, not this.

Secondary hazard from the same "Bun owns the file resolution" design: Bun clamps escaping symlinks with `openat2(RESOLVE_IN_ROOT)` on Linux only, and its own docs note routing is case-sensitive while macOS/Windows filesystems are not — so a symlink inside the tree can escape the mount on non-Linux hosts.

## Recommendation

The policy cannot be enforced inside a native Bun dir route, so enforce it at boot and in the docs: scan each mount at `resolveStaticDirs` time for dotfile entries (reuse `isExcludedDotPath`) and throw — or at minimum `logger.warn` naming the offending paths — and extend the warning callout in 160-serve-options.md to state that, unlike `publicDir` and `Mochi.file`, a mount serves dotfiles and must contain nothing secret. Suggest `publicDir`/`Mochi.file` for any tree whose contents aren't fully known.

## Revalidation

**Verdict:** true-positive

The primary claim is confirmed by the repository's own test. packages/mochi/src/staticDirs.test.ts writes .env containing SECRET=1 into the mounted tree (L14) and then asserts GET /assets/.env returns 200 (L101-104), with the comment 'Documented, not desired: Bun's directory route serves everything under the directory' — so the maintainers have empirically pinned the behavior and consider it a wart. resolveStaticDirs applies no content policy at all (only prefix shape, root-mount, metachar, assetPrefix, duplicate and stat checks), and registerStaticDirRoutes hands the directory to Bun as a native { dir } value (staticDirs.ts:57), where no dotfile notion exists. The divergence from the framework's own twice-implemented policy is real: isExcludedDotPath filters at scan time in publicDir.ts:14-27/54-58 (tests at publicDir.test.ts:36-56 assert .env and .git/config are skipped and only .well-known is allowed), and Mochi.file repeats the identical check at Mochi.ts:1480-1485 with a comment explicitly saying it matches the public-dir policy. I also verified the docs gap: the only warning callout for staticDirs (docs/160-serve-options.md:105-111) covers the request-pipeline bypass and says nothing about dotfiles, and grepping all of packages/docs turns up no dotfile statement for mounts. Traversal itself is genuinely handled (test L113-121 shows .., %2E%2E and %2F all 404), so the finding correctly scopes the issue to canonical dotfile segments. The feature is unreleased (VersionNote since=0.10.0), and it is aimed at exactly the trees most likely to hold a stray .env or a .git checkout, so the secure-default is worth adding before ship. One correction: the secondary symlink claim is overbroad — Bun's routing docs state the openat2(RESOLVE_IN_ROOT) rules are applied by Bun itself on macOS, FreeBSD, and on Linux without openat2; only on Windows does Bun 'follow symlinks wherever they lead'. The case-sensitivity caveat is accurate and is documented by Bun. Neither correction touches the dotfile finding.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
