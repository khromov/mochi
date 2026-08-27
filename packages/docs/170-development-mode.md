---
title: 'Development mode'
slug: development-mode
description: 'What the development flag enables: live reload, file watcher, route handler HMR, debug bar, and error overlay.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Development mode

Set the `development` flag on `Mochi.serve()` to switch between the dev and production runtime. It defaults to `true`.

```ts
// file: src/index.ts
await Mochi.serve({
  development: true, // the default
  routes,
});
```

When `development` is true, Mochi enables:

- **Live reload** — a `mochi-live-reload` web component connects to `/__mochi_live_reload` and refreshes the page on file changes.
- **File watcher** — watches `src/` and `public/`. An edit invalidates the SSR compile cache and emits `file:change` on `mochiEvents`.
- **Debug bar** — `<div id="mochi-dev-toolbar">` is injected into every page.
- **Error overlay** — build and runtime errors render on top of the page.
- **Bundle stats** — a JSON report is served at `${assetPrefix}/client/stats`.
- **Stack traces on `error` events** — `error` payloads include `stack`. In production `stack` is `undefined`.

<Callout type="warning">

Never run `development: true` in production. Stack traces leak through the `error` event and the error overlay, the file watcher holds open file descriptors, and SSR bundles recompile on every change instead of loading from the prebuilt manifest.

</Callout>

### `MODE=development` convention

Drive the flag from an env var so one entry file serves both `bun run dev` and `bun run start`:

```ts
// file: src/index.ts
await Mochi.serve({
  development: process.env.MODE === 'development',
  routes,
});
```

```json
// file: package.json
{
  "scripts": {
    "dev": "MODE=development bun src/index.ts",
    "start": "bun src/index.ts"
  }
}
```

`MODE` stays a user-space convention — you read it yourself, and `options.development` is what actually drives behavior. The one exception is [`isDev`](/docs/environment-constants/#isdev): module top-level code runs before `Mochi.serve()` resolves `development`, so until that call lands `isDev` falls back to reading `MODE` (or `NODE_ENV`) on its own.

### Live reload

Set `liveReload: false` to keep the debug bar and file watcher but skip the `/__mochi_live_reload` WebSocket and the `mochi-live-reload` web component. Defaults to whatever `development` is.

### File watcher

The watcher always covers `src/` and `public/`. Extend it with `additionalWatchPaths`:

```ts
// file: src/index.ts
await Mochi.serve({
  additionalWatchPaths: ['../content', './docs'],
  routes,
});
```

`additionalWatchPaths` is additive. Paths that do not exist on disk are skipped silently.

### Route handler HMR

**Route handler code** — `Mochi.api` handlers, `serverProps` resolvers, form `actions`, `Mochi.ws` handlers, `Mochi.sse` handlers — is hot-swapped without a restart. The watcher builds your entry (`src/index.ts`) to discover its transitive dependencies. When any change, it rebuilds the entry, re-reads the `routes` from its `Mochi.serve()` call, and updates the running server in place. Adding, removing, and editing route patterns all work without a restart. WebSocket connections stay open. The browser reloads to pick up updated `serverProps`.

<Callout type="warning">

Each reload re-evaluates the **entire first-party dependency graph** — every `let` / `const` at module scope is recreated. This is not just a stale-cache annoyance: a module-scoped singleton that holds an **OS resource** (a DB pool, a `setInterval`, a file watcher, an SMTP pool) is re-created on every save while the previous instance is orphaned with its resource still open. Nothing closes it, so usage grows one leak per save until a hard failure — a Postgres pool, for example, exhausts `max_connections` after a dozen saves and takes the database down for every client.

Moving the singleton "into a module the entry imports" does **not** help — that module is first-party, so it is exactly what gets re-evaluated. Hold the resource with [`pinGlobal`](/docs/utility-helpers/#process-singletons) instead, which pins one instance on `globalThis` that survives every reload:

```ts
// file: src/db/client.ts
import { SQL } from 'bun';
import { pinGlobal } from 'mochi-framework';

export function getSql() {
  return pinGlobal('app:sql', () => new SQL(process.env.DATABASE_URL!, { max: 8, idleTimeout: 30 }));
}
```

Call `getSql()` wherever you need the pool — every call returns the same instance, so route handlers and `serverProps` share the one set of connections:

```ts
// file: src/routes.ts
import { getSql } from './db/client';

export const routes = {
  '/users': Mochi.page('./src/Users.svelte', {
    serverProps: async () => ({
      users: await getSql()`SELECT id, name FROM users`,
    }),
  }),
};
```

Namespace your key with an `app:` prefix — the framework uses `__mochi_*__` for its own pins. Setting `idleTimeout` is worth it regardless: it bounds the damage from any pool that still escapes.

</Callout>

Mochi warns once per dev session — via the [`recompile:module-churn`](/docs/events/#recompilemodule-churn) event — after the entry has been re-imported ten times, printed by `consoleLogger()` as a `warn`-level `HMR` line. If you have deliberately accepted the churn (or your resources are all held with `pinGlobal`), silence just that line with a [`consoleLogger:line`](/docs/extensions/#consoleloggerline) filter — the same mechanism the framework uses to hide its own internal routes:

```ts
// file: src/index.ts
await Mochi.serve({
  filters: {
    'consoleLogger:line': (line, { source }) => (source.name === 'recompile:module-churn' ? null : line),
  },
  routes,
});
```

Returning `null` drops the line; returning it unchanged keeps it. This suppresses only the churn warning — every other log line is untouched.

### `file:change` event

Every watcher event re-emits on `mochiEvents` as `file:change`. Use it to invalidate your own caches:

```ts
// file: src/lib/docs-cache.ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('docs:cache-clear', 'file:change', ({ path }) => {
  if (path.endsWith('.md')) clearMyMarkdownCache();
});
```

<Callout type="warning">

**Use `setHandler` here, not `.on()`.** In dev, the module holding this handler can be re-run when Mochi recompiles. Each `.on()` call leaves behind another duplicate listener. `setHandler` registers by name, so re-running replaces the previous one.

</Callout>

In production the watcher never starts and `file:change` never emits.

### HMR rebuild logger lines

The built-in logger prints a structured line per save:

- `BUILD` — one per page compiled, plus a summary with total file count and duration.
- `BNDL` — one per `buildClientBundle()` call.
- `HMR ` — one per rebuild cycle. Note shows the trigger, `pages=N`, and `bundles=N`.

A healthy `bundles=` for a non-CSS save is `1`. A higher number means a regression to per-page bundling, which is O(N²) work for N hydratable pages.

<Callout type="warning">

**Use `logger: { compile: false }` to suppress rebuild lines.** It drops only `BUILD` / `BNDL` / `HMR` output. Disabling the whole logger loses other diagnostics.

</Callout>

### Barrel-import warning

Mochi warns when a dependency drags a large module into the build graph that is then almost entirely tree-shaken away:

```ts
import { Sun } from '@lucide/svelte'; // ❌ parses the whole ~100 KB re-export index every rebuild
import Sun from '@lucide/svelte/icons/sun'; // ✅ pulls only the one icon
```

Bun tree-shakes the barrel's modules, but it still re-parses the package's big re-export file on every rebuild, which slows HMR. In dev the warning fires once per package. A production `mochi-framework build` runs the same check and collapses every offender into one grouped summary line.

Tune or silence it with `barrelWarnings` on `Mochi.serve()`:

```ts
await Mochi.serve({
  barrelWarnings: false, // silence entirely
  // or keep it on but suppress a package / raise the threshold:
  barrelWarnings: { ignore: ['@lucide/svelte'], minBytes: 100 * 1024 },
  routes,
});
```

`minBytes` defaults to 50 KB. For richer logic than a static `ignore` list, register the [`barrel:warn` filter](/docs/extensions#barrelwarn).
