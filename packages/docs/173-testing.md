---
title: 'Testing'
slug: testing
description: 'Unit-test with bun:test and run full-app tests in isolated processes with the runTests helper.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Testing

<Callout type="warning">

Testing support is **experimental**. The `bun test` runner works well for plain unit tests today, but the full-app helper below is new and its API may change.

</Callout>

### Unit tests

Pure functions, stores, and any non-server logic test directly with [`bun test`](https://bun.sh/docs/cli/test) — no Mochi-specific setup:

```ts
// src/lib/slugify.test.ts
import { expect, test } from 'bun:test';
import { slugify } from './slugify';

test('lowercases and dasherizes', () => {
  expect(slugify('Hello World')).toBe('hello-world');
});
```

```sh
bun test
```

### Full-app tests

Tests that boot a real server with `Mochi.serve()` — to fetch a page, hit an API route, or assert on rendered HTML — must run **one file per process**. `Mochi.serve()` allows only one instance per process (it pins config on `globalThis.__mochi_config__`), so two server-booting test files in the same `bun test` run throw `Mochi.serve() has already been called.`

`runTests` solves this: it globs `src/**/*.test.ts` and runs each file in its own `bun test` process, parallelised across CPU cores. Add a small script to your package:

```ts
// scripts/run-tests.ts
#!/usr/bin/env bun
import { runTests } from 'mochi-framework';

await runTests();
```

Point your `test` script at it:

```json
// package.json
{
  "scripts": {
    "test": "bun scripts/run-tests.ts"
  }
}
```

```sh
bun run test
```

Each file gets a fresh process, so every test can call `Mochi.serve({ port: 0 })` without colliding:

```ts
// src/routes.test.ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

let server: Server;

beforeAll(async () => {
  server = await Mochi.serve({ port: 0, logger: { enabled: false }, routes });
});

afterAll(() => server.stop(true));

test('GET / renders', async () => {
  const res = await fetch(`http://localhost:${server.port}/`);
  expect(res.status).toBe(200);
});
```

#### Options

`runTests(options?)` accepts:

- **`dir`** — package root to scan and run tests from. Defaults to the current working directory.
- **`sequential`** — files (relative to `dir`) that must run on their own, after the parallel batch — for tests that can't share machine state with others:

```ts
await runTests({ sequential: ['src/liveReload.test.ts'] });
```

Each file's output streams as it finishes, but with many files running in parallel the failure you care about ends up buried. So `runTests` reprints a recap at the end of the run — every failed file, the names of the tests that failed in it, and their error output — and exits the process with code `1` if any file failed, so it drops straight into CI.

### Bun workspaces: use the hoisted linker

<Callout type="warning">

In Bun **workspaces**, `bun install` defaults to the isolated linker (a symlinked `node_modules/.bun` store). Combined with `bun test`, this trips a Bun bug: a second `Bun.build()` in the test process — e.g. `Mochi.serve()` compiling after your test file imported `mochi-framework` — fails with `EISDIR reading file` (or `Unexpected reading file`) on a dependency inside `node_modules/.bun`. This repo's root `bunfig.toml` works around it by pinning `[install] linker = "hoisted"`.

</Callout>

Fix: pin the hoisted linker in your workspace root `bunfig.toml`, then delete `node_modules` and reinstall:

```toml
# bunfig.toml
[install]
linker = "hoisted"
```

Single-package apps — including everything scaffolded by `create-mochi` — install hoisted by default and are unaffected.
