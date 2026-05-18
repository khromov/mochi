# Mochi memory-leak test harness

A first-pass HTTP leak harness: spawns the demo site in production mode, hits a
mix of routes for a fixed duration, samples RSS via `ps` plus an in-process
`process.memoryUsage()` probe, and reports a pass/warn/fail verdict.

## Run

```sh
bun run test:leak       # default: 60s warmup, 600s workload, 60s cooldown @ 50 rps
```

The harness cleans + rebuilds `packages/site` before each run so the production
manifest always matches the on-disk chunks. Pass `--skip-build` to reuse an
existing `.mochi/` (faster, but only safe if you know the build is fresh).

Flags (all optional):

```sh
bun run test:leak -- --duration=120 --rps=80 --warmup=30 --cooldown=30 --port=13333 --skip-build
```

The harness defaults to port `13333` (not `3333`) so it doesn't collide with a
running `bun run dev` server.

## What it does

1. **Boot** — spawns `bun src/index.ts` in `packages/site` with
   `MOCHI_MEMORY_PROBE=1` and `PORT=<--port>`. Readiness is confirmed by
   fetching `/__mochi/health/memory`, which only exists when the env var is set
   — so a 200 proves we're talking to _our_ spawned process, not someone else's
   server already on the port.
2. **Capture** — fetches `/demos/server-island` and scrapes the
   `<mochi-server-island …>` element so it can hit `/_mochi/island/<name>?props=…`
   with valid signed props for the rest of the run.
3. **Warmup** — drives traffic for `--warmup` seconds; samples discarded.
   Lets `ComponentRegistry` populate `compiledComponents` / `clientFiles` /
   `cssFileUrls`.
4. **Baseline** — pauses load, calls `/__mochi/health/memory` 3× back-to-back
   (first call triggers `Bun.gc(true)`); records the third reading.
5. **Workload** — drives traffic for `--duration` seconds. Samples RSS via
   `ps -o rss=,vsz= -p <pid>` every 2s. Calls the in-process probe every 60s.
6. **Cooldown** — quiet period to let in-flight settle.
7. **Final probe** — same protocol as baseline.
8. **Analyze** — least-squares regression on workload-phase RSS, excluding a
   leading slice of the workload (30s on long runs, `duration / 4` on short
   smoke tests). Compares baseline vs final. Compares first-minute p95 vs
   last-minute p95 for latency creep.

## Routes hit

See `routes.ts`. Each one exercises a different framework code path: minimal
page render, page with dynamic param + cookie jar, form action, server-island
endpoint, JSON API + `MochiCookieJar`, minimum-overhead API, error responder,
unmatched 404.

The captured server-island hit targets `/__leak/server-island` (defined in
`packages/site/src/leak-test/`), not `/demos/server-island` — the demo island
has an artificial 1–3s `delay()` that would dominate the harness's latency
stats and mask any real p95 creep signal.

## Verdict thresholds (first pass — tune after a few runs)

|      | slope (MB/min)              | final-baseline delta (MB) |
| ---- | --------------------------- | ------------------------- |
| pass | < 0.3 (and ≥ 1 GC dip seen) | < 15                      |
| warn | 0.3 – 1.0                   | 15 – 40                   |
| fail | > 1.0 OR strictly monotonic | > 40                      |

Slope thresholds only escalate the verdict when the linear fit is meaningful
(`r² ≥ 0.5`). RSS under load is noisy — when r² is low (e.g. 0.10), the
"slope" is just scatter, and acting on it produces false-positive FAILs (a run
with delta=−112 MB, latency improved, GC dips observed would otherwise fail
on a slope of 2.88 MB/min). Below the r² floor, the slope is reported but
ignored for verdict purposes.

Also fails on: error rate > 0.5%, or p95 latency creep > 50% (first vs last
minute of workload).

## Output

- Console table with the verdict, memory deltas, traffic mix, and per-route
  latency.
- Full timeline JSON at `packages/mochi/scripts/leak/reports/<timestamp>.json`
  (gitignored).

## Tradeoffs to know

- `Bun.gc(true)` is sync and blocks the event loop for tens of ms. The probe is
  only called at phase boundaries with load paused.
- The signed-props blob is captured once and reused — realistic, but a future
  signature-verification cache wouldn't be exercised across keys.
- RSS in Bun (JSC) includes deferred munmap regions; post-cooldown RSS can be
  much lower than mid-workload RSS even with no leak. Don't read too much into
  a single baseline-vs-final delta — the workload-phase slope is the primary
  signal. Expect baseline numbers in the 200–400 MB range on macOS.
- A **negative** `final – baseline` delta (e.g. baseline 268 MB, final 157 MB)
  is normal and not a sign of "negative leak". The baseline probe runs after
  warmup, when JIT tier-up code, freshly compiled Svelte components, and
  transient registry-build allocations are all still resident. By the final
  probe — after a cooldown plus a forced `Bun.gc(true)` — JSC has had time to
  reclaim and `madvise(MADV_FREE)` those pages back to the OS. The slope's
  `r²` tells you whether the workload-phase trend is meaningful: r² near 0
  (e.g. 0.01) means the slope is statistical noise, not a real signal.
- `fetch` uses `keepalive: true`. Without it, growth in Bun's socket pool would
  look like a server leak.
- HTTP-only first pass — WS/SSE leaks are out of scope. Add later if needed.

## Smoke-test the harness itself

To confirm the harness can detect a leak, add a `Mochi.api` route that pushes
to a module-level array on every request and re-run. Verdict should flip to
**fail**.
