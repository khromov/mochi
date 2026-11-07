# Contributing

## Local setup

`bun install` is enough on macOS and Linux. **On Windows you also need the Microsoft Visual C++ Redistributable:**

```sh
winget install --id Microsoft.VCRedist.2015+.x64 -e
```

`@mochi-framework/rsvelte` loads a prebuilt Rust binary that links against `VCRUNTIME140.dll`, which Windows does not ship in the box. Without it `bun run test` fails in `packages/mochi-rsvelte` and `packages/minimal-rsvelte` with `LoadLibrary failed: The specified module could not be found` — the binary is on disk, its C runtime is not. Everything else keeps working, because the framework falls back to `svelte/compiler`.

## Releases

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing. Write commits using [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: <summary>` → minor version bump
- `fix: <summary>` → patch version bump
- `feat!: <summary>` or a `BREAKING CHANGE:` footer → major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:` → no release
- `perf:` → patch

On push to `main`, release-please opens or updates a `chore(main): release …` PR with the pending version + changelog. Merging that PR creates a git tag, a GitHub Release, and publishes to npm with provenance.

Four packages are released independently, each with its own version, changelog and tag. Note that release-please strips
the npm scope when deriving the tag component, so a scoped package tags as `<unscoped-name>-v*`:

| Directory                      | npm package                      | Tag                  |
| ------------------------------ | -------------------------------- | -------------------- |
| `packages/mochi`               | `mochi-framework`                | `mochi-framework-v*` |
| `packages/cli`                 | `create-mochi`                   | `create-mochi-v*`    |
| `packages/mochi-rsvelte`       | `@mochi-framework/rsvelte`       | `rsvelte-v*`         |
| `packages/mochi-svelte-shaker` | `@mochi-framework/svelte-shaker` | `svelte-shaker-v*`   |

Adding a package to the release flow means: an entry in `release-please-config.json`, a starting version in `.release-please-manifest.json`, and a `publish-<name>` job plus a `republish` tag→directory case in `.github/workflows/release.yml`.

Non-conforming commit messages are ignored by release-please (no enforcement — they just don't contribute to the next release).

## npm publishing

Publishing uses npm **trusted publishing** (OIDC) — there is no `NPM_TOKEN` secret. The `release` workflow requests `id-token: write` and `npm publish --provenance` exchanges that for a short-lived credential. Each package must therefore have a trusted publisher configured on npmjs.com (package → Settings → Trusted Publisher) pointing at the `khromov/mochi` repository and the `.github/workflows/release.yml` workflow.

## Manual prerequisites (one-time, per package)

1. Verify the package name is available on npm (e.g. `npm view @mochi-framework/rsvelte`).
2. Configure the trusted publisher for it as described above. npm generally requires the package to exist first — if so, bootstrap with a single manual `npm publish` from the package directory, then attach the trusted publisher; CI handles every release after that.
3. Enable branch protection on `main` requiring the `test` workflow to pass.
