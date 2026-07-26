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

### Fuzzing the HTTP surface

Unit tests check the inputs you thought of. A property-based fuzz test generates the ones you didn't — malformed cookies, junk `Origin` headers, percent-encoded traversal, oversized bodies — and asserts that whatever comes back is still _well-behaved_. Pair [fast-check](https://fast-check.dev/) with a real `Mochi.serve()`:

```ts
// src/httpFuzz.fuzz.test.ts
import fc from 'fast-check';

const arbPath = fc.array(fc.oneof(fc.constantFrom('..', '%2e%2e', '%00', '.env'), fc.string({ maxLength: 12 })), { maxLength: 5 }).map((s) => '/' + s.join('/'));

test('no request produces a 5xx', async () => {
  await fc.assert(
    fc.asyncProperty(arbPath, async (p) => {
      const url = new URL(base);
      url.pathname = p; // assign, don't concatenate — `base + '//x'` collapses the slashes
      const res = await fetch(url, { redirect: 'manual' });
      await res.text(); // always drain: an unread body pins the socket and the next request looks like a hang
      expect(res.status).toBeLessThan(500);
    }),
    { numRuns: 1000 },
  );
});
```

Four invariants are worth asserting on every generated request:

- **No unexpected 5xx.** Write the fixture so nothing generated can legitimately fail, then treat any 5xx as a bug — an allow-list is only somewhere for a real one to hide.
- **No hang.** Drive an `AbortController` yourself so a client-side deadline stays distinguishable from a server-side abort, and clear the timer in a `finally`.
- **No info leakage.** Scan the body _and every header value_ for stack frames, absolute paths, and `node_modules/`. Skip matches that also appear in the request URL — a canonicalising redirect echoing your own input is reflection, not disclosure.
- **Protocol well-formedness.** No CR/LF in headers, parseable `Content-Type` and `Set-Cookie`, and every redirect `Location` on-origin. The sharpest check: feed the redirect target back through `trailingSlashRedirect()` and assert it returns `null` — a non-null result is a redirect loop.

<Callout type="warning">

Fuzz with `development: false`. In development mode Mochi deliberately attaches stack traces to error pages, so the leak invariant would fail on every error by design.

</Callout>

Two things to know. Bun's `fetch()` silently rewrites an unrecognised method to `GET` and refuses a body on `GET`/`HEAD`/`OPTIONS`, so method fuzzing through it is capped at the standard set. And `new URL()` resolves dot-segments — encoded ones too — before your handler sees the path, so a traversal property is really asserting that the _normalized_ path can't escape.

Keep `numRuns` a variable so the same file serves both roles:

```sh
bun test src/httpFuzz.fuzz.test.ts                                  # fast, on every run
MOCHI_FUZZ_RUNS=20000 bun test --timeout 900000 src/httpFuzz.fuzz.test.ts   # soak
```

Read the seed and shrink path from the environment too — fast-check prints both on failure, so a counterexample becomes directly re-runnable.

### Bun workspaces: use the hoisted linker

<Callout type="warning">

In Bun **workspaces**, `bun install` defaults to the isolated linker (a symlinked `node_modules/.bun` store). Combined with `bun test`, this trips a Bun bug: a second `Bun.build()` in the test process — e.g. `Mochi.serve()` compiling after your test file imported `mochi-framework` — fails with `EISDIR reading file` (or `Unexpected reading file`) on a dependency inside `node_modules/.bun`. See the [minimal reproduction](https://github.com/khromov/bun-second-build-eisdir-repro).

</Callout>

Fix: pin the hoisted linker in your workspace root `bunfig.toml`, then delete `node_modules` and reinstall:

```toml
# bunfig.toml
[install]
linker = "hoisted"
```

Single-package apps — including everything scaffolded by `create-mochi` — install hoisted by default and are unaffected.
