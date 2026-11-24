# [BUG] Synchronous spawnSync('ps') every 2s blocks the same event loop that generates load and measures latency

**File:** [`packages/mochi/scripts/leak/sampler.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/scripts/leak/sampler.ts#L15-L34) (lines 15, 33, 34)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`sampleRss` uses `spawnSync` (L15), and `startRssPoller` invokes it from a `setInterval` every `intervalMs` — 2000ms per `runLeakTest.ts:88`. The harness is a single Bun process that simultaneously runs the load generator (13 concurrent workers at the default 50 rps) and times every request with `performance.now()` (`loadGen.ts:93,109`). `spawnSync` blocks that single event loop for the full fork/exec/wait of `ps`, typically on the order of 5-20ms and worse under load.

Every blocked interval is attributed to whichever requests happen to be in flight, so the harness injects its own fork/exec cost directly into the p50/p95 it then gates on: `judge` fails the run when `latencyCreepPct > 50` (`analyze.ts:139`). Because the blocking happens at a fixed 2s cadence while request rate and duration vary, the contamination is not even uniform across the first-window and last-window comparison in `runLeakTest.ts:163-164`. For a tool whose entire output is a latency and memory verdict, measuring with an instrument that perturbs the measurement is a methodological defect rather than a style nit.

## Recommendation

Make the sampler non-blocking: use `Bun.spawn({ cmd: ['ps', …], stdout: 'pipe' })` and await the output, or read `/proc/<pid>/statm` on Linux via `Bun.file`. Better still, move RSS sampling into a separate process (or a `Worker`) so it cannot contend with the load generator at all. While there, note that `out.status !== 0` (L16) misses the `spawnSync` `error` case (e.g. `ps` absent, as on Windows) — it returns null either way, which `runLeakTest.ts:150-152` reports as 'ps did not return any output', so this is cosmetic but worth distinguishing in the message.

## Revalidation

**Verdict:** true-positive

The code facts are fully confirmed: `sampler.ts:1` imports `spawnSync` from `node:child_process`, `sampleRss` (L15) calls it synchronously, and `startRssPoller` (L33-34) drives it from a `setInterval` at the 2000ms cadence passed by `runLeakTest.ts:88`. That interval runs on the same single event loop as `startLoad`'s 13 workers (loadGen.ts:138) and the `performance.now()` latency measurements at loadGen.ts:93/109. So the instrument does block the thing it measures — that part is not disputable, and for a harness whose only output is a latency-and-memory verdict the fix (`Bun.spawn` with awaited output, `/proc/<pid>/statm`, or a separate Worker) is clearly correct. I do want to correct the magnitude, because the finding overstates it twice. First, in-flight concurrency is `rps × latency`, i.e. roughly 0.25-2.5 requests at 50 rps with single-digit-to-tens-of-ms latencies — not 13 — so each ~5-20ms block inflates on the order of 300 samples out of ~30,000 in a default run (~1%), which moves p99 far more than the p95 the gate reads. Second, the claim that the contamination 'is not even uniform across the first-window and last-window comparison' does not hold: the sampler cadence is a fixed 2s and the request rate is fixed, so both 60s windows absorb the same ~30 blocking events and the perturbation largely cancels in the `lastWindow.p95 / firstWindow.p95` ratio at analyze.ts:139. The secondary note is accurate and correctly labelled cosmetic: `out.status !== 0` (L16) returns null for a missing `ps` too (status is `null`, not 0), so the operator sees `runLeakTest.ts:151`'s 'ps did not return any output' rather than 'ps not found' — on Windows that is the path taken. Keeping BUG, which is already the lowest severity available.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-05-18)
