# [BUG] Production release stage built on an unpinned third-party `:latest` base image

**File:** [`packages/demos/Dockerfile.production`](https://github.com/khromov/mochi/blob/main/packages/demos/Dockerfile.production#L30-L61) (lines 30, 57, 61)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-supply-chain`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The final release stage of this production image uses `FROM frolvlad/alpine-glibc:latest` — a mutable tag on a non-official, third-party Docker Hub account, with no version floor and no digest. Every rebuild resolves `:latest` to whatever that account currently publishes, so the base OS of the production runtime is attacker-controlled if the upstream account or its publishing pipeline is ever compromised, and silently drifts otherwise. `RUN apk add --no-cache libgcc ncdu` then installs packages from whatever repository snapshot that image pins, so the image's patch level is entirely a function of an upstream third party. This file is the clear outlier in the repo: every other Dockerfile pins a specific official tag (`oven/bun:1.4.4-alpine`, `oven/bun:1.4.4`, `node:24-slim`) and parameterizes it via the `BUN_IMAGE` build arg. Impact is bounded by the fact that `.github/workflows/build.yml` builds the demos leg from the root `Dockerfile`, not this one, so this path is not currently on the CI/CapRover deploy route — but it is committed as the production variant for `packages/demos` and is reachable by anyone building it by hand. Exploitation is contingent on upstream compromise rather than directly remote-triggerable, hence MEDIUM. Secondary nit on the same stage: `ncdu` (an interactive disk-usage TUI) is unnecessary attack surface in a production image, and `chown -R bun:bun packages/demos/src` makes the directory the runtime imports its source from writable by the runtime user, which converts any arbitrary-file-write primitive into persistent code execution.

## Recommendation

Pin the release base to an immutable digest and prefer an official/maintained image, ideally reusing the same parameterized base as the other Dockerfiles: `ARG BUN_IMAGE=oven/bun:1.4.4-alpine` plus `FROM ${BUN_IMAGE}@sha256:<digest> AS release`, with Renovate/Dependabot configured to bump the digest. If the glibc base is genuinely required for `@tailwindcss/oxide`, pin it as `frolvlad/alpine-glibc@sha256:<digest>`. Drop `ncdu` from the production image, and narrow the `chown` to the specific generated-CSS target rather than the whole `src` tree (or generate `app.generated.css` into `.mochi` at build time so `src` can stay read-only).

## Revalidation

**Verdict:** true-positive

The central factual claim is accurate and verified: packages/demos/Dockerfile.production:30 is `FROM frolvlad/alpine-glibc:latest AS release` — a mutable tag on a non-official third-party Docker Hub account, with no version floor and no digest, in the stage that becomes the runtime filesystem. Every rebuild resolves `:latest` to whatever that account currently publishes, and line 57's `apk add --no-cache libgcc ncdu` inherits whatever repository snapshot that image pins. It is genuinely the repo's outlier: I checked every Dockerfile and all the others pin a specific official tag — root `Dockerfile`, `Dockerfile.production` and `Dockerfile.memtest` all use `ARG BUN_IMAGE=oven/bun:1.4.4-alpine`, `packages/minimal/Dockerfile` uses `oven/bun:1.4.4-alpine`, `.devcontainer/Dockerfile` uses `node:24-slim`, and this file's own base stage uses `oven/bun:1.4.4`. The repo has already moved away from this base elsewhere for unrelated reasons — root Dockerfile:14-17 notes "Earlier revisions used frolvlad/alpine-glibc with a copied bun binary; that combo broke @tailwindcss/oxide's native binding on linux/arm64" — so this is a stale leftover. The finding's reachability hedge is also correct: build.yml's demos matrix leg specifies `dockerfile: Dockerfile`, not this file, so it is not on the CI/CapRover deploy route and is only built by hand. I am downgrading from MEDIUM to BUG for two reasons. First, there is no remotely triggerable attack — exploitation is wholly contingent on an upstream account or pipeline compromise, and the artifact is not deployed, so this is dependency hygiene rather than an exposure. Second, the two secondary claims do not hold up as outliers: the root Dockerfile also runs `apk add --no-cache ncdu` and also does `chown -R bun:bun packages/${WORKSPACE}/src`, with an in-file rationale ("demos' tailwind step writes app.generated.css into src/ at startup"), so both are the repo's deliberate, documented, repo-wide pattern and not something this file introduces. The pinning recommendation is still worth taking.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
