---
name: update-bun
description: Upgrade Bun to the latest version and sync the pinned version across .bun-version, Dockerfile, Dockerfile.production, and @types/bun in package.json. Use when the user asks to "update bun", "upgrade bun", or "bump bun version".
user-invocable: true
---

# Update Bun version

This skill upgrades the local Bun install to the latest release and propagates the new version to every place it is pinned in the repo.

## Pinned locations

- `.bun-version` — bare semver, no `v` prefix (e.g. `1.3.12`). Also consumed by `oven-sh/setup-bun@v2` via `bun-version-file: .bun-version` in `.github/workflows/test.yml`, so CI is updated automatically.
- `Dockerfile` line 2 — `FROM oven/bun:<version> AS base` (no `v` prefix)
- `Dockerfile.production` line 2 — `FROM oven/bun:<version> AS base` (no `v` prefix)
- `package.json` — `"@types/bun"` dependency, pinned exactly (no `^`, no `latest`)

## Steps

1. Install the latest Bun:

   ```sh
   curl -fsSL https://bun.com/install | bash
   ```

2. Get the new version:

   ```sh
   bun --version
   ```

   Output is a bare semver like `1.3.12`. Call this `$NEW`.

3. Read `.bun-version` to get `$OLD` (e.g. `1.3.11`). The file stores a bare semver with no `v` prefix.

4. If `$NEW == $OLD`, report "Bun is already up to date at $NEW" and stop. Do not touch any files.

5. Otherwise, update the four files using the Edit tool:
   - **`.bun-version`**: write `$NEW` (overwrite full content, no `v` prefix).
   - **`Dockerfile`**: replace `oven/bun:$OLD` with `oven/bun:$NEW`.
   - **`Dockerfile.production`**: replace `oven/bun:$OLD` with `oven/bun:$NEW`.
   - **`package.json`**: update the `@types/bun` entry. If the current value is `"latest"`, replace `"@types/bun": "latest"` with `"@types/bun": "$NEW"`. If it is already a pinned version (`"@types/bun": "$OLD"`), replace that string with `"@types/bun": "$NEW"`.

6. Refresh the lockfile and formatting:

   ```sh
   bun install
   bun run format
   ```

7. Report the upgrade: `Bun $OLD → $NEW` and list the four files modified.

## Notes

- The `bun --version` output has no `v` prefix. No file should have a `v` prefix — `.bun-version`, the Dockerfile tags, and `@types/bun` all use bare semver.
- Do not run `bun upgrade` — the `curl | bash` installer is the canonical path used by this project.
- If the shell PATH still points at the old Bun after installing, use the fresh install path printed by the installer (typically `~/.bun/bin/bun`) for the `bun --version` check.
