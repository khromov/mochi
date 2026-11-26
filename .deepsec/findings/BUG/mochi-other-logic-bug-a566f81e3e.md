# [BUG] `bun install` without `--frozen-lockfile` lets lockfile drift pass CI and fail later on main

**File:** [`.github/workflows/test.yml`](https://github.com/khromov/mochi/blob/main/.github/workflows/test.yml#L59) (lines 59)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The install step runs bare `bun install` (line 59). Every other installing workflow in the repo that gates correctness uses `bun install --frozen-lockfile` (site-health.yml:31, review.yml:48, release.yml:88/115/142/169/195). Because this workflow is the PR gate, a PR that edits a `packages/*/package.json` dependency without regenerating `bun.lock` will install happily here — Bun re-resolves and rewrites the lockfile in the runner — so CI goes green on a tree that no longer matches the committed lockfile. The first thing to notice is release.yml, whose `--frozen-lockfile` steps run *after* the merge, on main, breaking the release pipeline rather than the PR that caused it. The `bun run syncpack` step (line 62) does not cover this: it compares declared version ranges across workspaces, not package.json against bun.lock. A secondary effect is non-reproducible runs — the `restore-keys: ${{ runner.os }}-bun-` fallback (line 56) serves a cache built from a different lockfile hash, and a non-frozen install is free to resolve newly published versions inside existing caret ranges.

## Recommendation

Change the step to `bun install --frozen-lockfile` so lockfile drift fails on the PR that introduces it, matching site-health.yml, review.yml and release.yml.

## Revalidation

**Verdict:** true-positive

The core mechanic is confirmed. Line 59 is a bare `bun install`, and `git log --follow` shows it has never carried the flag (not a deliberate removal). Bun's own documentation settles the key question: 'Bun does not enable --frozen-lockfile automatically in CI; pass the flag or use bun ci', and `install.frozenLockfile` defaults to `false`; the repo's bunfig.toml sets only `linker = "hoisted"`. So drift between a `packages/*/package.json` and `bun.lock` is silently re-resolved in the runner and the required `test` gate stays green. I also confirmed the cited frozen installs (site-health.yml:31, review.yml:48, release.yml 88/115/142/169/195) and that a real delayed failure exists — just not where the finding points: `Dockerfile:31` runs `bun install --frozen-lockfile`, and build.yml fires on every push to main for the site and demos legs, so a drifted merge red-lines the deploy build on main. Four corrections: (a) format.yml:38 is also a bare install, so 'every other correctness-gating workflow' is overstated; (b) release.yml does *not* break — its `release-please` job has a dedicated `Sync bun.lock` step (58-68, added deliberately in cb61372d) that runs a bare `bun install` on the release branch and auto-commits `chore: sync bun.lock`, so the publish jobs' frozen installs see a consistent tree; (c) review.yml:48 *does* fail on the offending PR, so the drift is surfaced — just on a non-required check while the required gate misleads; (d) 'free to resolve newly published versions inside existing caret ranges' is wrong, since with an in-sync lockfile Bun installs the locked versions and only re-resolves entries whose ranges no longer match, and `restore-keys` only serves a content-addressed download cache. Net: a genuine low-severity CI hygiene bug whose recommended fix matches the repo's own convention. BUG severity is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-09)
