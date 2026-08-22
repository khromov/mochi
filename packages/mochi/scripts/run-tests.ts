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
  windowsSequential: [
    // Its last case races three concurrent runners against one SQLite file, so it
    // depends on the OS resolving writer-vs-writer lock contention inside the
    // runner's 30s busy_timeout. Windows file locking is slow enough that four
    // test files competing for the disk push it past that: the leg failed twice
    // in a row here, once with SQLITE_BUSY and once hanging outright, while
    // Linux/macOS settle the same race in ~15ms. Running it after the parallel
    // batch removes the competing load; the test itself is unchanged.
    'src/migrations/runnerSqlite.test.ts',
  ],
  // See testing.ts `windowsSkip`. Both suites' logic is OS-agnostic and fully
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
  ],
});
