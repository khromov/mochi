#!/usr/bin/env bun
import { runTests } from 'mochi-framework';

// demoLlms.test.ts boots the whole site with no prebuilt manifest, so every component compiles
// inside the hook — ~26s alone, and past the 60s default when the root `bun run test` fans every
// workspace out in parallel and starves it of CPU.
await runTests({ fileTimeoutMs: 240_000 });
