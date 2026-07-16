import { afterAll } from 'bun:test';

// Preloaded into every `bun test` child by `runTests` (via --preload).
//
// A `bun test` process can pass every test yet fail to drain-and-exit on Windows —
// a Bun runtime quirk, not a leak we can clear from the tests (even our own timers
// are unref'd, and the affected suites use in-memory storage with no OS handles).
// Once the suite finishes, schedule a force-exit with the code Bun computed for the
// run, so a wedged child terminates itself instead of being killed at the runner's
// hard deadline (and reported as a false timeout).
//
// The timer is unref'd, so it never delays a healthy process: Bun exits on its own
// first and the timer is simply discarded. It only ever fires when something is
// still (wrongly) keeping the loop alive after the run is done — exactly the wedge
// case. By then Bun has finished reporting and set process.exitCode, so the forced
// exit carries the real pass/fail result.
afterAll(() => {
  const timer = setTimeout(() => process.exit(process.exitCode ?? 0), 4000);
  timer.unref?.();
});
