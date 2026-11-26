# [BUG] freePort() has a TOCTOU window: the probe releases the port before the dev server claims it

**File:** [`packages/site/scripts/shoot.ts`](https://github.com/khromov/mochi/blob/main/packages/site/scripts/shoot.ts#L101-L113) (lines 101, 104, 106, 113)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

freePort() (L101-106) binds an ephemeral listener on port 0, reads `probe.port`, stops the probe, and returns the number. The port is only actually claimed later, when `Bun.spawn` boots the dev server at L111-117 and that process binds it. Between `probe.stop(true)` and the dev server's bind, any other process on the machine — including a second concurrent `shoot.ts`, which this script makes easy to run — can take the port.

The stop is also not awaited: `Bun.serve().stop(true)` returns a promise, so the probe's listener may still be closing when the child tries to bind it.

The failure is hard to diagnose because it compounds with the undrained-pipe finding: the dev server dies with EADDRINUSE, its stderr is discarded, and the operator sees either a bare `Dev server exited with code N` or a full 120-second wait ending in `Dev server did not start answering`, with no indication that a port race was the cause.

## Recommendation

Close the hole rather than narrowing it: let the dev server pick its own port (PORT=0) and discover the bound port by parsing its startup line from a drained stdout, or retry the whole allocate-and-boot sequence on a bind failure. At minimum `await probe.stop(true)` so the probe's socket is fully released before the port is handed on.

## Revalidation

**Verdict:** true-positive

The race is structurally present exactly as described. `freePort()` (L101-106) binds `Bun.serve({port: 0})`, reads `probe.port`, calls `probe.stop(true)` and returns the number; the port is only actually claimed later, in a different process, when `Bun.spawn(['bun','run','dev'])` at L111-117 boots and binds it. I confirmed the child really does consume that number rather than ignoring it: the spawn passes `PORT`/`MOCHI_PORT`, `packages/site/package.json`'s `dev` script is `NODE_ENV=development bun src/index.ts`, and `src/index.ts:114` reads `Number(process.env.PORT) || 3333`. So between the probe's release and the child's bind, anything on the machine can take the port — including a second concurrent `shoot.ts`, which this script makes trivial to run. The secondary claim also checks out against Bun's docs: `stop(closeActiveConnections?: boolean): Promise<void>` and 'The returned promise resolves once every connection has closed', yet L104 discards that promise, so the probe's listener may still be closing when the child attempts the bind. The diagnostic impact compounds with F8: the child dies with EADDRINUSE, its stderr is discarded, and the operator sees either a bare `Dev server exited with code N` or a full 120-second wait, with nothing pointing at a port race. The window is narrow in practice (the kernel generally doesn't hand back a just-released ephemeral port immediately), which matches BUG severity rather than anything higher — but `await probe.stop(true)` at minimum, and ideally letting the server pick its own port and parsing it from a drained stdout, are the right fixes.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
- Stanislav <stanislav.khromov@gmail.com> (2026-08-22)
