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
    // Spawns two full `Mochi.serve()` subprocesses and reasons about lease TTLs in
    // wall-clock time, so it is both a heavy load spike and sensitive to being
    // starved itself. Run outside the parallel batch for the same reason as above.
    'src/serveTasksFailover.test.ts',
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
