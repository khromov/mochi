# [BUG] `docker compose down` exit code ignored before destructive `rmSync` of the Postgres data directory

**File:** [`packages/docker/scripts/reset.ts`](https://github.com/khromov/mochi/blob/main/packages/docker/scripts/reset.ts#L9-L21) (lines 9, 10, 11, 21)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The script awaits `down.exited` but never inspects the exit code, then unconditionally `rmSync`es `./.db` with `{ recursive: true, force: true }`. The surrounding try/catch only traps a synchronous `spawn` launch failure (i.e. the `docker` binary missing from PATH) — a non-zero exit is not an exception, so the 'docker not available — skipping `docker compose down`' warning is effectively unreachable in the common failure case where the `docker` CLI exists but the daemon is unreachable, or where compose fails for a project-name/permission reason while containers are still up. In that case the script silently proceeds to delete the data directory out from under a live `postgres:15` container, which is bind-mounted at `./.db` per packages/docker/docker-compose.yml, producing a crashed/corrupted cluster rather than a clean reset. No security impact: both the compose argv and `dbDir` are static (`path.resolve(import.meta.dir, '..')`), with no user-controlled input and no traversal vector.

## Recommendation

Capture the exit code (`const code = await down.exited`) and abort with a clear message when it is non-zero, before deleting anything — e.g. `if (code !== 0) { console.error('docker compose down failed (code N) — refusing to delete ./.db while containers may still be running'); process.exit(1); }`. Checking `docker compose ps -q` for remaining containers before `rmSync` would be a stronger guard.

## Revalidation

**Verdict:** true-positive

The code defect is real and verified. `reset.ts:9-13` awaits `down.exited` and discards the result, then unconditionally `rmSync(dbDir, { recursive: true, force: true })` at line 21. I empirically checked Bun's spawn semantics with an unrelated one-liner (`Bun.spawn` on a nonexistent binary): it throws `ENOENT` *synchronously*, before returning, and the `await proc.exited` line is never reached. So the `try/catch` traps only 'the docker binary is not on PATH'; a non-zero exit — daemon unreachable, docker-socket permission denied, or a compose failure — resolves `exited` normally and never reaches the warning, exactly as claimed. The sibling script sets the correct precedent: `scripts/dev.ts:17` checks `(await probe.exited) === 0`. I also confirmed `docker-compose.yml` bind-mounts `./.db:/var/lib/postgresql/data` under the pinned project `name: mochi`, and that both the compose argv and `dbDir` (`path.resolve(import.meta.dir, '..')`) are static — so the finding's 'no security impact / no traversal vector' assessment is correct. I'd temper the stated consequence: the harmful case needs compose to fail *while containers are still up*, which is narrow (if the daemon is down there is nothing running), the pinned project name rules out the project-name variant, and on Linux the uid-999-owned `.db` usually trips the existing EACCES branch instead. Also, this script's entire purpose is to destroy that data, so the realistic cost is a confusing live-container-on-deleted-datadir state the user must clear with `db:down`, not data loss. Still a genuine ignored-exit-code bug with an unreachable warning; BUG (the lowest available severity) is appropriate.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-08)
