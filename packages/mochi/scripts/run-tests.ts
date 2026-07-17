#!/usr/bin/env bun
import { runTests } from 'mochi-framework';

await runTests({
  sequential: ['src/liveReloadFilter.test.ts'],
  // Passes every test but deterministically wedges in Bun's native post-test
  // shutdown on Windows (even run alone; in-memory storage, no handles of ours) —
  // a Bun runtime bug we can't recover from in JS. Its cache logic is OS-agnostic
  // and fully covered on Linux/macOS. See testing.ts `windowsSkip`.
  // TODO: Take another pass at making the windows store tests work, especially when Bun >1.4.0 is released
  windowsSkip: ['src/cache/cache.test.ts'],
});
