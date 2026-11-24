# [MEDIUM] Template image has no `USER` directive, so the scaffolded app runs as root — unlike every other Dockerfile in the repo

**File:** [`packages/minimal/Dockerfile`](https://github.com/khromov/mochi/blob/main/packages/minimal/Dockerfile#L1-L13) (lines 1, 13)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-container-hardening`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The final (and only) build stage declares no `USER`, so `CMD ["bun", "run", "start"]` on line 13 executes as uid 0. The `oven/bun` images follow the official-Node convention of creating an unprivileged `bun` user but leaving root as the default — confirmed within this repo, where the release stage of `Dockerfile.production` successfully runs `RUN apk add --no-cache ncdu` (which requires root) *before* its `USER bun` on line 107, and where comments explicitly note 'The workspace tree above is COPYed as root'.

This deviates from the project's own established baseline: every other Dockerfile here drops privileges — `Dockerfile:70`, `Dockerfile.production:107`, `packages/demos/Dockerfile.production:63`, and `Dockerfile.memtest:57` all end with `USER bun`, and the production files go to real trouble to support it (`COPY --chown=bun:bun`, `chown -R bun:bun` on `.mochi`, `.db`, and `/data/image-cache`). The omission therefore looks like an oversight in the template rather than a considered choice, and it is inherited by every project generated from `create-mochi --template minimal`.

Consequences are defense-in-depth rather than directly exploitable, but concrete for an SSR framework: any code execution reached through the app or a transitive dependency lands as root, with write access to the application source and `node_modules` under `/app` — enough to persist a backdoor across restarts whenever the directory is volume-backed — plus the broader kernel/syscall surface that root inside a container exposes for escape attempts (and full control if the container is ever run with `--privileged` or a mounted Docker socket). Secondary operational effect: files written to any bind-mounted volume come out root-owned.

## Recommendation

Add a privilege drop before `CMD`, matching the pattern already used in `Dockerfile.production`: precreate and chown the runtime-writable paths (`RUN mkdir -p /app/.mochi && chown -R bun:bun /app`), then `USER bun` ahead of line 13. Prefer `COPY --chown=bun:bun . .` on line 8 over a trailing `RUN chown -R`, which would duplicate the whole application layer. Consider also adding the `HEALTHCHECK` probe against the bare `/health` route that the other Dockerfiles carry — `packages/minimal/src/index.ts` already serves it.

## Revalidation

**Verdict:** true-positive

Confirmed as a factual deviation from the project's own baseline. packages/minimal/Dockerfile is 13 lines, single-stage, with no `USER` and no `HEALTHCHECK`, so `CMD ["bun", "run", "start"]` at line 13 runs as uid 0. The claim that `oven/bun` defaults to root is independently supported from inside this repo: Dockerfile.production runs `RUN apk add --no-cache ncdu` (root-only) before switching at line 107, and all four other Dockerfiles explicitly switch — root Dockerfile:70, Dockerfile.production:107, packages/demos/Dockerfile.production:63, Dockerfile.memtest:57 — which would be pointless if `bun` were already the default user. The production files also go to real trouble to support the drop (`chown -R bun:bun` on `.mochi`/`src`, `/data/image-cache`), reinforcing that the template's omission is an oversight rather than a decision. Because the template ships verbatim through create-mochi (chain verified under F8), every `--template minimal` scaffold inherits it. I agree with the finding's own framing that this is defense-in-depth rather than directly exploitable: it needs a separate code-execution primitive before root matters, at which point the consequences are write access to /app source and node_modules (a backdoor that persists across restarts on a volume-backed mount), a wider syscall surface for escape attempts, and root-owned files on bind mounts. One correction to the recommendation's aside: the 'add a HEALTHCHECK like the other Dockerfiles' point is only partly supported, since packages/demos/Dockerfile.production has none either — though packages/minimal/src/index.ts:15 does serve `/health`, so the probe would work. MEDIUM is a touch generous for a pure hardening gap, but with no lower security tier available I am leaving it unchanged.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-26)
