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

Testing support is **experimental**. The `bun test` runner works well for plain unit tests today. The full-app helper below is new, and its API may change.

</Callout>

### Unit tests

Test pure functions, stores, and any non-server logic directly with [`bun test`](https://bun.sh/docs/cli/test) — no Mochi-specific setup:

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

A test that boots a real server with `Mochi.serve()` must run **one file per process**. `Mochi.serve()` allows one instance per process, so two server-booting test files in the same `bun test` run throw `Mochi.serve() has already been called.`

`runTests` solves this. It globs `src/**/*.test.ts` and runs each file in its own `bun test` process, parallelised across CPU cores. Add a small script:

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
- **`sequential`** — files (relative to `dir`) that must run on their own, after the parallel batch, for tests that cannot share machine state:

```ts
await runTests({ sequential: ['src/liveReload.test.ts'] });
```

`runTests` reprints a recap at the end — every failed file, the failing test names, and their error output — and exits with code `1` if any file failed.

### Bun workspaces: use the hoisted linker

<Callout type="warning">

In Bun **workspaces**, `bun install` defaults to the isolated linker. Combined with `bun test`, this trips a Bun bug: a second `Bun.build()` in the test process fails with `EISDIR reading file` on a dependency inside `node_modules/.bun`. Pin the hoisted linker in your workspace root `bunfig.toml`:

```toml
# bunfig.toml
[install]
linker = "hoisted"
```

Then delete `node_modules` and reinstall. Single-package apps — including everything scaffolded by `create-mochi` — install hoisted by default and are unaffected.

</Callout>
