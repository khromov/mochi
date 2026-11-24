# [MEDIUM] Production image resolves all dependencies without a lockfile, so builds are non-reproducible and unreviewed

**File:** [`Dockerfile.production`](https://github.com/khromov/mochi/blob/main/Dockerfile.production#L32-L37) (lines 32, 36, 37)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-supply-chain`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The install stage copies only package directories (L32-35), then synthesizes a fresh root `package.json` with `printf` (L36) and runs `RUN cd /temp/prod && bun install --production --omit=dev` (L37). No `bun.lock` is ever copied into `/temp/prod`, and the comment at L28-29 confirms this is deliberate ("Lockfile is regenerated"). Consequently every direct and transitive dependency of the production image is re-resolved from the registry at image-build time against the semver ranges in each package.json, rather than pinned to the audited set in the repo's committed `bun.lock`.

This matters because of what this file deploys. Per .github/workflows/build.yml:67-69, `Dockerfile.production` is the image for `packages/support` — the one app in the monorepo that holds real credentials (`SMTP_*`, `ADMIN_PASSWORD`, `MOCHI_ORIGIN`) and the only one with a live SMTP transport and a subscriber database. Any compromised or typosquatted in-range release of any package in that tree (a patch bump of a transitive dep is enough) is pulled into the image silently, with no lockfile diff for a reviewer to notice and no way to reproduce a known-good build later for forensics. A postinstall script in such a package executes during `bun install` in the build, inside CI, with registry network access.

The inconsistency is the tell: the dev-mode `Dockerfile` does this correctly at L31 (`bun install --frozen-lockfile`), and `Dockerfile.memtest` at L23 likewise. Only the production image — the one carrying secrets — omits the lockfile.

This also compounds the base-image tags flagged by the scanner (L23 `FROM ${BUN_IMAGE}` with `BUN_IMAGE=oven/bun:1.4.4-alpine` at L21, reused at L30/51/66). Those are at least version-pinned, so tag mutability alone is a weak concern, but combined with floating dependency resolution nothing about the resulting image is content-addressed.

## Recommendation

Copy the root `bun.lock` into `/temp/prod` and install with `--frozen-lockfile`, matching the other two Dockerfiles. If the narrowed-workspace trick makes the root lockfile unusable, the cleaner fix is to keep the real root `package.json` + `bun.lock` and let `--production --omit=dev` plus `--filter` prune, rather than synthesizing a manifest that discards the lockfile. For defence in depth, also pin `BUN_IMAGE` by digest (`oven/bun:1.4.4-alpine@sha256:...`) so all four stages are content-addressed.

## Revalidation

**Verdict:** true-positive

Verified exactly as described, and the in-repo evidence is actually stronger than the finding cites. Dockerfile.production L32-35 copies only package directories, L36 synthesizes a narrowed root manifest with `printf`, and L37 runs `bun install --production --omit=dev` — no `bun.lock` ever reaches `/temp/prod`, and the L28-29 comment confirms the regeneration is deliberate. With no lockfile present Bun re-resolves every direct and transitive dependency from the registry against the semver ranges at image-build time, with no integrity pins and no lockfile diff for a reviewer to see. The inconsistency the finding calls the tell is worse than two-of-three: the root `Dockerfile` (L29/31) and `Dockerfile.memtest` (L21/23) both do `COPY package.json bun.lock` + `--frozen-lockfile`, and `packages/demos/Dockerfile.production` (L9/17) does `COPY package.json bun.lock` + `bun install --frozen-lockfile --production --omit=dev` — so three of four get it right, and the exact clean pattern the recommendation asks for already exists in this repo. Only the one image carrying real secrets omits it: build.yml L67-74 makes `support` the sole leg on Dockerfile.production, and that app holds `ADMIN_PASSWORD`, `SMTP_*` and the subscriber database. Its tree is caret-ranged (`svelte: ^5.57.3`, `@nprapps/sidechain: ^1.1.5`, plus the whole `mochi-framework` tree), so the attack path is concrete and matches real 2025 npm incidents: one malicious in-range patch release lands in the image and runs in the process holding those credentials. One correction that trims the escalation without touching the verdict — Bun does not execute arbitrary lifecycle scripts by default (only for its default-trusted list or declared `trustedDependencies`), so the "postinstall executes inside CI" step is weaker than stated; the durable exposure is the unreviewed runtime code and the loss of a reproducible build for forensics. The base-image digest suggestion is fair hardening but not a finding on its own, since `BUN_IMAGE` is already version-pinned. MEDIUM is appropriate given the secrets involved and the trivial fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
