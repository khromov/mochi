#!/usr/bin/env bun
import { runTests } from 'mochi-framework';

await runTests({
  sequential: [
    // Asserts a *single* write produces exactly one `reload` message, so it
    // can't defend itself the way publicDirSpaces.test.ts does — re-touching to
    // give the watcher another chance would emit extra reloads and break the
    // assertion. Under full-suite parallel load chokidar/fsevents can drop an fs
    // event outright, and a dropped event is unrecoverable: the test waits out
    // its 30s timeout. Running it after the parallel batch removes the load.
    'src/liveReloadFilter.test.ts',
  ],
  // See testing.ts `windowsSkip`. Every suite's logic is OS-agnostic and fully
  // covered on Linux/macOS.
  windowsSkip: [
    // Passes every test but deterministically wedges in Bun's native post-test
    // shutdown on Windows (even run alone; in-memory storage, no handles of
    // ours) — a Bun runtime bug we can't recover from in JS.
    // TODO: Take another pass at making the windows store tests work, especially when Bun >1.4.0 is released
    'src/cache/cache.test.ts',
    // Windows has no POSIX signal delivery: `proc.kill('SIGTERM')` maps to
    // TerminateProcess, so the child dies with 143 before any handler runs.
    // There is no way to signal another process for it to observe, so the
    // shutdown path is only testable on Linux/macOS.
    'src/shutdownSignal.test.ts',
    // Its concurrency case races three runners against one SQLite file, so what
    // it really asserts is an OS property — how fast writer-vs-writer lock
    // contention clears — not anything Mochi controls. Linux settles it in ~15ms;
    // Windows repeatedly blew past the runner's 30s busy_timeout into
    // SQLITE_BUSY. WAL does not help: the contention is between writers, which
    // WAL still serializes. The one-at-a-time serial lane did not fix it either.
    'src/migrations/runnerSqlite.test.ts',
    // Hangs on Windows at the first test that aborts a transaction, until the
    // 60s file deadline kills it. The stall is in @electric-sql/pglite-socket's
    // QueryQueueManager: with the backend left in a transaction under a departed
    // handler, processQueue finds no query from that handler, breaks, and never
    // drains what other handlers queued behind it. Third-party, and only
    // reachable through the socket bridge the fixture needs to speak the wire
    // protocol; the serial lane did not fix this one either.
    'src/migrations/runnerPostgres.test.ts',
  ],
});
