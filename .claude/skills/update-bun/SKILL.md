---
name: update-bun
description: Upgrade Bun to a target version (default latest) and sync the pin across all nine locations — .bun-version, the devcontainer, build.yml's matrix, the four Dockerfiles, and @types/bun in every package.json plus .syncpackrc.json. Use when the user asks to "update bun", "upgrade bun", or "bump bun version".
user-invocable: true
---

# Update Bun version

This skill upgrades Bun and propagates the new version to every place it is pinned in the repo.

The target version is **optional**: if the user names one (e.g. "update bun to 1.4.2"), pin exactly that. Otherwise upgrade to the latest release.

## Pinned locations

All nine must move together. Grep for the old version before finishing — a missed location fails CI or silently ships the wrong runtime.

1. **`.bun-version`** — bare semver, no `v` prefix. Consumed by `oven-sh/setup-bun@v2` via `bun-version-file: .bun-version` in **seven** workflows (`test.yml`, `format.yml`, `release.yml`, `review.yml`, `site-health.yml`, `svelte-latest-test.yml`, `cli-regression-test.yml`), so all of CI follows this one file. Do not edit the workflows for this. (`test.yml` and `cli-regression-test.yml` each also run a separate `bun-version: canary` leg — that one is deliberate and never pinned.)
2. **`.devcontainer/Dockerfile`** — `ARG BUN_VERSION=<v>` (feeds `curl … | bash -s "bun-v${BUN_VERSION}"`, which is the one place a `v` prefix appears, already supplied by the template).
3. **`.devcontainer/devcontainer.json`** — the `BUN_VERSION` build arg, which must match the line above.
4. **`.github/workflows/build.yml`** — **three** `bun_image: oven/bun:<v>-alpine` matrix entries (the `site`, `demos`, and `support` legs). All three, not one.
5. **`Dockerfile`** — `ARG BUN_IMAGE=oven/bun:<v>-alpine`, **plus a prose comment above it** that names the tag ("Base image defaults to oven/bun:…"). Move both.
6. **`Dockerfile.production`** — `ARG BUN_IMAGE=oven/bun:<v>-alpine`, **plus its own prose comment** naming the tag ("Base image is oven/bun:…"). Move both.
7. **`Dockerfile.memtest`** — `ARG BUN_IMAGE=oven/bun:<v>-alpine` (no prose comment here).
8. **`packages/demos/Dockerfile.production`** — `FROM oven/bun:<v> AS base`. Note: **no `-alpine` suffix** on this one.
9. **`packages/minimal/Dockerfile`** — `FROM oven/bun:<v>-alpine`.

And the types pin, which moves on its own schedule (see the `@types/bun` note below):

- **`@types/bun`** in **all 13 `package.json` files** — the root plus `packages/{cli,demos,docker,minimal,minimal-rsvelte,mochi,mochi-rsvelte,mochi-svelte-shaker,shared,site,support,video-animations}`. Pinned exactly (no `^`, no `latest`).
- **`.syncpackrc.json`** — the versionGroup labelled "Pin @types/bun across the workspace" carries its own hard `pinVersion`. It **must** move in lockstep with the 13 package.json files or `syncpack lint` fails.

## Steps

1. Determine `$NEW`:
   - If the user named a target version, use it verbatim.
   - Otherwise install the latest and read the version back:

     ```sh
     curl -fsSL https://bun.com/install | bash
     bun --version
     ```

     Output is a bare semver like `1.4.2`.

2. Read `.bun-version` to get `$OLD`. If `$NEW == $OLD`, report "Bun is already up to date at $NEW" and stop without touching any files.

3. Update the nine runtime locations above from `$OLD` to `$NEW`. Do not blind-replace `$OLD` repo-wide — see the false-positives note below.

4. Pick the `@types/bun` version. It tracks Bun **minors**, so a package matching `$NEW` exactly often does not exist. Check npm first:

   ```sh
   bun info @types/bun version          # latest
   bun info @types/bun versions --json  # all published
   ```

   Pin the newest published version that is `<= $NEW`. It is expected and fine for this to lag the runtime pin (precedent: runtime 1.4.2 with `@types/bun` 1.4.1, because 1.4.2 was never published). Update all 13 package.json files **and** `.syncpackrc.json` to that version.

5. Refresh and verify:

   ```sh
   bun install
   bun run syncpack     # must report no issues
   bun run typecheck    # the real test for an @types/bun move
   bun run format
   ```

   A runtime-only bump (no `@types/bun` change) leaves the lockfile untouched; an `@types/bun` bump is expected to move it.

6. Report `Bun $OLD → $NEW`, the `@types/bun` version chosen (and why, if it lags), and the files modified.

## Notes

- **Do not bump `engines.bun` or `MIN_BUN_VERSION`.** The `"bun": ">=1.4.0"` in the root `package.json`, `MIN_BUN_VERSION` in `packages/mochi/src/cli/checkEnvironment.ts`, and the matching prose in `README.md` / `packages/docs/` are a **support floor**, not a pin — they declare the oldest Bun that Mochi runs on. Raising them drops support for users on older Bun and is a breaking change requiring its own deliberate `feat!:` commit (precedent: `bfe317c feat!: require Bun >=1.4`). A routine version bump must leave all of them alone.
- **`@types/bun` tracks Bun minors, not patches.** Never assume a `@types/bun@$NEW` exists — check npm (step 4). Pinning a nonexistent version fails `bun install`.
- **Beware a global find-and-replace of `$OLD`.** These matches must _not_ change:
  - `packages/cli/src/utils.test.ts` asserts `bunVersionWarning('1.4.2')` is null. That is a sample value exercising the 1.4 floor logic, not a pin — rewriting it is pointless churn.
  - `packages/docs/185-docker.md` shows `oven/bun:1.4-alpine`, a deliberate floating **minor** tag for users' own Dockerfiles. It moves on a minor bump, never on a patch bump.
  - `packages/site/package.json` has `"valibot": "1.4.2"`, an unrelated package that can coincidentally share the version string.
- `.devcontainer/codebay.devcontainer.json` and `.devcontainer/devcontainer-lock.json` may also carry a `BUN_VERSION`, but they are untracked sandbox artifacts listed in `.git/info/exclude`. Leave them alone; they are not part of the repo.
- No file stores a `v` prefix — `.bun-version`, the image tags, `BUN_VERSION`, and `@types/bun` all use bare semver. (The `.devcontainer/Dockerfile` install command adds `bun-v` itself.)
- Do not run `bun upgrade` — the `curl | bash` installer is the canonical path used by this project, and it is the only one that can target a specific version (`bash -s "bun-v$NEW"`).
- If the shell PATH still points at the old Bun after installing, use the fresh install path printed by the installer (typically `~/.bun/bin/bun`) for the `bun --version` check.
