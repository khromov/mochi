# Memory-regression harness

A self-contained Docker container that runs `packages/site` and continuously
exercises it to surface memory leaks. It captures a V8 heap snapshot to a mounted
volume on a fixed interval so heap growth can be diffed in Chrome DevTools over a
multi-day unattended run on a dedicated server.

`memtest/driver.ts` is a single Bun process that:

1. **Spawns the site** (`bun run dev:site`, dev mode — matches what CI deploys) as a
   child process, so the site's heap stays isolated from the driver's.
2. **Waits** for `/health/` to report ready.
3. **Load loop** — fetches `/sitemap.xml`, re-anchors each `<loc>` to the local
   server, and fetches every URL with bounded concurrency, forever. The sitemap
   covers `/`, every doc, and every internal demo, so almost every Mochi feature
   is exercised each pass.
4. **Snapshot loop** — every `SNAPSHOT_INTERVAL_MS`, downloads `/_heapsnapshot`
   (`Bun.generateHeapSnapshot('v8')`) with **curl** to
   `/snapshots/heap-<timestamp>.heapsnapshot`, then prunes to the newest
   `SNAPSHOT_KEEP` files. curl runs as a separate process so the large body
   streams to disk with constant memory and never contends with the load loop
   (draining the ~20 MB response inside the driver deadlocks on TCP backpressure).
   `curl` is installed in the image; a local dry run needs it on `PATH` (standard
   on macOS/Linux).
5. **Memory-trend loop** — every `MEM_LOG_INTERVAL_MS`, polls
   `/__mochi/health/memory` (forces GC, needs `MOCHI_MEMORY_PROBE=1`) and logs a
   post-GC `rss/heapUsed/external` line for a cheap continuous signal between
   snapshots.

If the site process dies, the driver exits non-zero so Docker's restart policy
recycles the container.

## Run

```sh
colima start          # if the Docker runtime isn't running
./memtest/run.sh      # build + run detached, snapshots -> volume mochi-heapsnapshots
docker logs -f mochi-memtest
```

Or manually:

```sh
docker build -f Dockerfile.memtest -t mochi-memtest .
docker run -d --restart unless-stopped -v mochi-heapsnapshots:/snapshots -p 3333:3333 mochi-memtest
```

## Retrieve snapshots

```sh
# List
docker run --rm -v mochi-heapsnapshots:/snapshots alpine ls -lh /snapshots
# Copy the whole volume to the host
docker cp mochi-memtest:/snapshots ./heapsnapshots
```

Open a `.heapsnapshot` in Chrome DevTools → **Memory** → **Load profile**. Load two
snapshots taken hours apart and use the **Comparison** view to find retained objects
that only grow.

## Environment variables

| Var                    | Default      | Meaning                                           |
| ---------------------- | ------------ | ------------------------------------------------- |
| `PORT`                 | `3333`       | Site port (driver targets `127.0.0.1:$PORT`).     |
| `SNAPSHOT_DIR`         | `/snapshots` | Where snapshots are written (the mounted volume). |
| `SNAPSHOT_INTERVAL_MS` | `3600000`    | Snapshot cadence (1h).                            |
| `SNAPSHOT_KEEP`        | `48`         | Retain the newest N snapshots; older are pruned.  |
| `CONCURRENCY`          | `8`          | Parallel in-flight requests in the load loop.     |
| `LOOP_DELAY_MS`        | `0`          | Pause between full sitemap passes.                |
| `MEM_LOG_INTERVAL_MS`  | `300000`     | Post-GC memory log cadence (5m).                  |
| `READY_TIMEOUT_MS`     | `120000`     | Max wait for `/health/` on startup.               |
| `SPAWN_SITE`           | `true`       | Set `false` to drive an externally started site.  |

## Local dry run (no Docker)

```sh
PORT=4444 bun run dev:site &                     # start the site
SPAWN_SITE=false PORT=4444 SNAPSHOT_DIR=./.memtest-out \
  SNAPSHOT_INTERVAL_MS=60000 MEM_LOG_INTERVAL_MS=15000 \
  MOCHI_MEMORY_PROBE=1 bun memtest/driver.ts      # drive it
```
