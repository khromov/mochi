# Contributing

## Releases

This repo uses [release-please](https://github.com/googleapis/release-please) for automated versioning and publishing. Write commits using [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: <summary>` → minor version bump
- `fix: <summary>` → patch version bump
- `feat!: <summary>` or a `BREAKING CHANGE:` footer → major bump
- `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:` → no release
- `perf:` → patch

On push to `main`, release-please opens or updates a `chore(main): release mochi-framework` PR with the pending version + changelog. Merging that PR creates a git tag, a GitHub Release, and publishes to npm with provenance.

Non-conforming commit messages are ignored by release-please (no enforcement — they just don't contribute to the next release).

## Manual prerequisites (one-time)

1. Verify the `mochi-framework` name is available on npm: `npm view mochi-framework`. If taken, rename in `packages/mochi/package.json`.
2. Create an npm Granular Access Token (npmjs.com → Access Tokens → Generate → Granular) with read+write on the package.
3. Add the token as repo secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
4. Enable branch protection on `main` requiring the `test` workflow to pass.
