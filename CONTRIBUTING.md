# Contributing

## Releases

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing. Write commits using [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: <summary>` → minor version bump
- `fix: <summary>` → patch version bump
- `feat!: <summary>` or a `BREAKING CHANGE:` footer → major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:` → no release
- `perf:` → patch

On push to `main`, release-please opens or updates a `chore(main): release …` PR with the pending version + changelog. Merging that PR creates a git tag, a GitHub Release, and publishes to npm with provenance.

Three packages are released independently, each with its own version, changelog and tag:

| Directory                | npm package                | Tag                           |
| ------------------------ | -------------------------- | ----------------------------- |
| `packages/mochi`         | `mochi-framework`          | `mochi-framework-v*`          |
| `packages/cli`           | `create-mochi`             | `create-mochi-v*`             |
| `packages/mochi-rsvelte` | `@mochi-framework/rsvelte` | `@mochi-framework/rsvelte-v*` |

Adding a package to the release flow means: an entry in `release-please-config.json`, a starting version in `.release-please-manifest.json`, and a `publish-<name>` job plus a `republish` tag→directory case in `.github/workflows/release.yml`.

Non-conforming commit messages are ignored by release-please (no enforcement — they just don't contribute to the next release).

## npm publishing

Publishing uses npm **trusted publishing** (OIDC) — there is no `NPM_TOKEN` secret. The `release` workflow requests `id-token: write` and `npm publish --provenance` exchanges that for a short-lived credential. Each package must therefore have a trusted publisher configured on npmjs.com (package → Settings → Trusted Publisher) pointing at the `khromov/mochi` repository and the `.github/workflows/release.yml` workflow.

## Manual prerequisites (one-time, per package)

1. Verify the package name is available on npm (e.g. `npm view @mochi-framework/rsvelte`).
2. Configure the trusted publisher for it as described above. npm generally requires the package to exist first — if so, bootstrap with a single manual `npm publish` from the package directory, then attach the trusted publisher; CI handles every release after that.
3. Enable branch protection on `main` requiring the `test` workflow to pass.
