# [BUG] kill() resolves as soon as SIGKILL is dispatched rather than after the child exits, and fires a stray SIGKILL after a clean shutdown

**File:** [`packages/mochi/scripts/leak/serverProcess.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/serverProcess.ts#L65-L68) (lines 65, 66, 67, 68)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`kill()` (L65-68) sends SIGTERM, then awaits `Promise.race([proc.exited, Bun.sleep(3000).then(() => proc.kill('SIGKILL'))])`. `proc.kill` returns synchronously once the signal is dispatched, so the sleep branch's `.then` resolves immediately after SIGKILL is sent — the race resolves there without ever awaiting `proc.exited`. `runLeakTest.ts:208` awaits this in its `finally` and then calls `process.exit(code)` (L215), so the harness can terminate while the child is still being torn down.

Two consequences. First, a server that ignores SIGTERM and is slow to die on SIGKILL (large heap, pending writes) can outlive the harness still bound to port 13333, which makes the *next* run fail its `isPortInUse` precheck (L24-26) with a message pointing the operator at an 'existing process' they did not knowingly start. Second, in the normal case where SIGTERM works, the 3s timer is still pending and later fires `proc.kill('SIGKILL')` against an already-reaped subprocess — harmless here, but it is dead code that obscures the intended semantics.

## Recommendation

Await the actual exit after escalating, and cancel the timer on clean shutdown — e.g. `const t = setTimeout(() => proc.kill('SIGKILL'), 3000); try { await proc.exited; } finally { clearTimeout(t); }`. That guarantees `kill()` resolves only once the child is gone and drops the stray post-exit signal.

## Revalidation

**Verdict:** true-positive

The described semantics are exactly right. `serverProcess.ts:65-68` does `proc.kill('SIGTERM')` then `await Promise.race([proc.exited, Bun.sleep(3000).then(() => proc.kill('SIGKILL'))])`. `Subprocess.kill()` returns synchronously once the signal is dispatched, so the sleep branch's `.then` callback resolves the moment SIGKILL is sent — the race settles there without ever awaiting `proc.exited`. `runLeakTest.ts:208` awaits this inside `finally` and L215 then calls `process.exit(code)`, so the harness can and does terminate while the child is mid-teardown. I verified the 3s branch is the COMMONLY taken one, not an edge case: `Mochi.serve()` installs a SIGTERM handler (Mochi.ts:2216) whose shutdown path waits `options.shutdownTimeout ?? (development ? 0 : 5_000)` — 5000ms here, since the harness forces `NODE_ENV=production` and the site sets no `shutdownTimeout` — and a non-forced `server.stop()` will not drain while the harness's own `keepalive: true` sockets (loadGen.ts:104) are still open, so `proc.exited` reliably resolves later than 3s. Practical harm is modest, which is why BUG is the right severity: SIGKILL is uncatchable and the kernel releases the port within milliseconds, and an orphan is reaped by launchd/init, so the 'next run fails its isPortInUse precheck' scenario needs a child wedged in uninterruptible I/O. The 'stray SIGKILL after a clean shutdown' sub-claim is weaker still — in the SIGTERM-succeeds path `process.exit()` at L215 fires before the pending 3s timer, so the stray signal is effectively unreachable dead code. The real defect is that a `finally`-block cleanup advertises confirmed teardown and does not provide it; the proposed `setTimeout` + `await proc.exited` + `clearTimeout` fix is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
