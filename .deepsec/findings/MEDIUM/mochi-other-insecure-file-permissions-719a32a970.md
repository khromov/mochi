# [MEDIUM] Freshly minted MOCHI_KEY written to .env with default world-readable permissions

**File:** [`packages/mochi/src/cli/generateKey.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/generateKey.ts#L33-L53) (lines 33, 41, 53)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-insecure-file-permissions`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`generateKey()` mints the framework's single root secret — `randomBytes(32)`, correctly a CSPRNG — and persists it with `Bun.write(envPath, …)` (L33, L41, L53-56). `Bun.write` creates a new file with mode `0666 & ~umask`, i.e. `0644` under the usual umask of 022, so on the `created` path the `.env` holding MOCHI_KEY is readable by every local account. (The `appended`/`replaced` paths overwrite an existing inode and inherit whatever mode it already had, so the exposure is specific to creating the file.) No `chmod` appears anywhere in the repo.

Per this project's own threat model, MOCHI_KEY is the single secret behind server-island prop sealing, image-transform URL signing, captcha tokens, protection clearance cookies and the demo session cookie, so disclosure collapses several trust boundaries at once. The prerequisite is a second local principal able to read the file — another user on a shared build host, a lower-privileged service account in the same container, or a CI image layer that bakes the file in — which is why this is MEDIUM rather than higher.

## Recommendation

Write the file with owner-only permissions and tighten an existing one: create via `node:fs` `writeFileSync(envPath, data, { mode: 0o600 })` (or `openSync(envPath, 'wx', 0o600)`), and `chmodSync(envPath, 0o600)` after an append/replace when the current mode is group- or world-readable. Note the POSIX-only caveat for Windows, where the bits are ignored.

## Revalidation

**Verdict:** true-positive

I verified the permission claim empirically instead of trusting the stated default: under Bun 1.4.5 with umask 022, `Bun.write(path, data)` on a new path produces mode 0644 (identical to `fs.writeFileSync`). So generateKey.ts's `created` branch (L32-34) writes the freshly minted 32-byte MOCHI_KEY into a world-readable `.env`. The key itself is correctly generated (`randomBytes(32).toString('base64url')`, L27 — a CSPRNG, not `Math.random`). The finding's precision is good: the `appended` (L41) and `replaced` (L53-56) branches hit an existing inode with O_TRUNC semantics and inherit its mode, so the exposure is specific to creation, and I confirmed there is no `chmod`/`mode:` anywhere in `packages/mochi/src` or `packages/cli/src` outside a test fixture (resolveOutDir.test.ts). Impact matches the project's own threat model — MOCHI_KEY is the single secret behind island prop sealing, image URL signing, captcha tokens, protection clearance and the demo session cookie — so a read collapses several boundaries at once. The honest caveats keep this from being higher: it requires a second local principal (shared build host, lower-privileged service account in the same container, a baked image layer), and 0644 is the ecosystem norm for `.env` written by any editor or `echo`, so the CLI is no worse than its surroundings. Against that, a tool whose sole job is minting a root secret is held to the `ssh-keygen`/`gh auth` standard of 0600, and the recommended fix (`writeFileSync(..., { mode: 0o600 })` or `Bun.write(..., { mode: 0o600 })` — the `mode` option exists in bun-types — plus a tightening `chmodSync` on append/replace) is trivial. I'd place it at the low end of MEDIUM, but MEDIUM is defensible; the Windows no-op caveat in the recommendation is also correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
