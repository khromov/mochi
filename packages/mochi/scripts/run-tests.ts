#!/usr/bin/env bun
import { runTests } from 'mochi-framework';

await runTests({ sequential: ['src/liveReloadFilter.test.ts'] });
