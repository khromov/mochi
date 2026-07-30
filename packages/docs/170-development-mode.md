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
- **File watcher** — `chokidar` watches `src/` and `public/`. An edit invalidates the SSR compile cache and emits `file:change` on `mochiEvents`.
- **Debug bar** — `<div id="mochi-dev-toolbar">` is injected into every page.
- **Error overlay** — build and runtime errors render on top of the page.
- **Bundle stats** — a JSON report is served at `${assetPrefix}/client/stats`.
- **Stack traces on `error` events** — `error` payloads include `stack`; in production `stack` is `undefined`.

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

`MODE` is a user-space convention. Mochi reads only `options.development`.

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

**Route handler code** — `Mochi.api` handlers, `serverProps` resolvers, form `actions`, `Mochi.ws` handlers, `Mochi.sse` handlers — is hot-swapped without a restart. The watcher builds your entry (`src/index.ts`) to discover its transitive dependencies. When any change, it rebuilds the entry, re-reads the `routes` from its `Mochi.serve()` call, and updates the running server in place. Adding, removing, and editing route patterns all work without a restart. WebSocket connections stay open; the browser reloads to pick up updated `serverProps`.

<Callout type="warning">
Do <strong>NOT</strong> rely on module-scoped mutable state surviving a route HMR cycle. Each reload re-evaluates the entire entry dependency graph, resetting any <code>let</code> / <code>const</code> at module scope. Move shared state into a module the entry imports (an in-memory store or database), and keep top-level side effects idempotent.
</Callout>

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
