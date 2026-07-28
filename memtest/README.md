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
4. **Snapshot loop** — captures a **baseline snapshot immediately after readiness**,
   before any load is applied, then every `SNAPSHOT_INTERVAL_MS` downloads `/_heapsnapshot`
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
colima start             # if the Docker runtime isn't running
sudo ./memtest/run.sh    # build + run detached, snapshots -> ./snapshots
docker logs -f mochi-memtest
```

Or manually:

```sh
docker build -f Dockerfile.memtest -t mochi-memtest .
sudo mkdir -p snapshots && sudo chown 1000:1000 snapshots
docker run -d --restart unless-stopped -v "$PWD/snapshots:/snapshots" mochi-memtest
```

The `chown` matters: a bind mount keeps the **host** directory's ownership,
overriding the image's `chown bun:bun /snapshots`, so an unwritable directory
makes every capture fail with `snapshot capture failed`. `run.sh` does it for
you (reading the uid out of the image rather than assuming 1000) — run it with
`sudo` so the chown succeeds.

The site's port is **not published** by default — the driver talks to it over
`127.0.0.1` inside the container, and publishing would expose `/_heapsnapshot`
(a full heap dump) and `/__mochi/health/memory` to whatever can reach the host.
To browse the site under load anyway, bind it to loopback only:

```sh
PUBLISH=127.0.0.1 ./memtest/run.sh
```

## Stop a run

```sh
docker stop mochi-memtest                      # end the run; snapshots are kept
docker stop mochi-memtest && docker rm mochi-memtest   # ...and drop the container
```

`docker stop` also clears the `unless-stopped` policy, so the harness stays down
across a host reboot — it will not come back until you run `run.sh` again. The
container gets SIGTERM; the site is a grandchild of the driver and the `bun run`
shims don't forward signals, so expect the stop to take the full 10s timeout
before Docker force-kills. Nothing is lost — snapshots are written to the host
mount as they're captured, and a run interrupted mid-capture just leaves the
partial file behind.

## Retrieve snapshots

Snapshots land in `./snapshots` on the host, so pull them straight off the box:

```sh
ls -lh snapshots
# From your laptop — they're JSON and compress ~5-10x, so tar anything bulky.
scp you@server:'~/mochi/snapshots/heap-*.heapsnapshot' ./
```

Or, to set up a local analysis run, use `bun run memtest:pull` — it syncs the
**whole series** into `./snapshots` off the remote box (defaults
`REMOTE_HOST=k@192.168.10.75`, `REMOTE_DIR=mochi/snapshots`; overridable). It's
incremental: rsync only fetches snapshots you don't already have and prunes ones
removed on the remote, so re-running after a few new captures is cheap.

Then `bun run memtest:analyze` diffs them with memlab, feeding it the **oldest,
midpoint, and newest** local snapshots — the widest window, so a slow leak has
room to show rather than hiding between two adjacent hourly captures. Add
`--full` (`bun run memtest:analyze --full`) to skip the condensed summary and
print memlab's verbatim VERBOSE report instead.

### Slow, diffuse growth (`--growth`)

memlab's default `findLeaks` is a pattern detector — it clusters objects that
survive a growth window and match known leak shapes. A heap that just _creeps_
(a cache gaining a few entries an hour, an array appended to steadily) often
trips none of those patterns, so `findLeaks` reports nothing while RSS climbs.
For that, use the trend mode over the whole series:

```sh
bun run memtest:analyze --growth
```

It runs memlab's `ShapeUnboundGrowthAnalysis` across every snapshot in
`./snapshots` (object **shapes** whose count/size climb monotonically) plus a
**constructor count/size delta** table from the oldest to newest snapshot — the
programmatic version of the DevTools Comparison view. A shape or constructor that
grows every snapshot is the leak candidate; grep it in the framework and find
what's holding the reference.

Open a `.heapsnapshot` in Chrome DevTools → **Memory** → **Load profile**. Load two
snapshots taken hours apart and use the **Comparison** view to find retained objects
that only grow.

## Environment variables

| Var                      | Default          | Meaning                                                                     |
| ------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `PORT`                   | `3333`           | Site port (driver targets `127.0.0.1:$PORT`).                               |
| `HEAP_SNAPSHOTS_ENABLED` | `true` _(image)_ | Set on the **site** process; registers `/_heapsnapshot`. Unset elsewhere.   |
| `PUBLISH`                | _(unset)_        | `run.sh` only: host address to publish `PORT` on.                           |
| `SNAPSHOT_DIR`           | `/snapshots`     | Where snapshots are written (the mounted volume).                           |
| `SNAPSHOT_INTERVAL_MS`   | `3600000`        | Snapshot cadence (1h).                                                      |
| `SNAPSHOT_KEEP`          | `168`            | Retain the newest N snapshots; older are pruned (7 days at hourly cadence). |
| `CONCURRENCY`            | `8`              | Parallel in-flight requests in the load loop.                               |
| `LOOP_DELAY_MS`          | `0`              | Pause between full sitemap passes.                                          |
| `MEM_LOG_INTERVAL_MS`    | `300000`         | Post-GC memory log cadence (5m).                                            |
| `READY_TIMEOUT_MS`       | `120000`         | Max wait for `/health/` on startup.                                         |
| `SPAWN_SITE`             | `true`           | Set `false` to drive an externally started site.                            |

## Local dry run (no Docker)

```sh
HEAP_SNAPSHOTS_ENABLED=true PORT=4444 bun run dev:site &   # start the site
SPAWN_SITE=false PORT=4444 SNAPSHOT_DIR=./.memtest-out \
  SNAPSHOT_INTERVAL_MS=60000 MEM_LOG_INTERVAL_MS=15000 \
  MOCHI_MEMORY_PROBE=1 bun memtest/driver.ts               # drive it
```

`HEAP_SNAPSHOTS_ENABLED=true` goes on the **site** process, not the driver — the
driver spawns the site with its own env in the container case, so
`Dockerfile.memtest` already sets it there. Without it the site never registers
`/_heapsnapshot` and every capture fails with a 404.
