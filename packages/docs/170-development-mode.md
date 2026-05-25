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
- **File watcher** — `chokidar` watches `src/` and `public/`; edits invalidate the SSR compile cache and emit `file:change` on `mochiEvents`.
- **Debug bar** — `<div id="mochi-dev-toolbar">` is injected into every page and the per-request payload is seeded onto `window.__mochi_debug`.
- **Error overlay** — build and runtime errors render via `buildErrorOverlay` on top of the page (dev only).
- **Error console script** — the same errors are also pushed through `console.error` via `buildErrorScript` (runs in dev and prod).
- **Bundle stats** — a JSON report is served at `${assetPrefix}/client/stats` (default `/_mochi/client/stats`).
- **Stack traces on `error` events** — `error` payloads include `stack`; in production `stack` is `undefined`.

<Callout type="warning">
Never run `development: true` in production. Stack traces leak through the `error` event and the error overlay, the file watcher holds open file descriptors, and SSR bundles are recompiled on every change instead of loaded from the prebuilt manifest.
</Callout>

### `MODE=development` convention

Wire the flag from an env var so one entry file serves both `bun run dev` and `bun run start`:

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

`MODE` is a user-space convention — Mochi reads only `options.development`. Do **NOT** read `process.env.NODE_ENV` to drive the flag; instead, pass `development` explicitly so test runners and one-off scripts get the same behaviour.

### Live reload

Set `liveReload: false` to keep the debug bar and file watcher but skip the `/__mochi_live_reload` WebSocket and the `mochi-live-reload` web component. Defaults to whatever `development` is set to.

```ts
// file: src/index.ts
await Mochi.serve({
  development: true,
  liveReload: false, // debug bar stays, WS does not
  routes,
});
```

### File watcher

The watcher always covers `src/` and `public/`. Extend it with `additionalWatchPaths`:

```ts
// file: src/index.ts
await Mochi.serve({
  additionalWatchPaths: ['../content', './docs'],
  routes,
});
```

Defaults are always included — `additionalWatchPaths` is additive. Paths that don't exist on disk are skipped silently.

### Route handler HMR

Svelte component changes are picked up automatically via the SSR compile cache. **Route handler code** — `Mochi.api` handlers, `serverProps` resolvers, form `actions`, `Mochi.ws` handlers, `Mochi.sse` handlers — is also hot-swapped when the route module or any of its transitive dependencies changes.

By convention Mochi looks for `./src/routes.ts` (then `.js`) at startup. Override with `routeModule`:

```ts
// file: src/index.ts
await Mochi.serve({
  routeModule: './src/my-routes.ts', // default: auto-discovered
  routes,
});
```

When a dependency of the route module changes the framework re-bundles it, reimports the fresh handlers, and updates the running server — no restart, no lost WebSocket connections. The browser is notified to reload so pages pick up updated `serverProps`.

<Callout type="info">
Adding or removing route **patterns** (not just editing handlers) still requires a server restart. The hot-swap updates handler implementations for existing patterns only.
</Callout>

Do **NOT** rely on module-scoped mutable state surviving a route HMR cycle; instead, move shared state into a separate module that the route module imports (e.g. an in-memory store or database) — each rebuild re-evaluates the route module and resets any `let` / `const` declared at module scope.

### `file:change` event

Every watcher event is re-emitted on `mochiEvents` as `file:change`. Use it to invalidate your own caches without restarting:

```ts
// file: src/lib/docs-cache.ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('docs:cache-clear', 'file:change', ({ path }) => {
  if (path.endsWith('.md')) clearMyMarkdownCache();
});
```

`path` is absolute; `type` is `'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'`. The event fires synchronously, before the debounced browser reload, so subscribers are caught up by the time the next request arrives.

Do **NOT** register `file:change` handlers with `.on()` from a module that can be re-imported by the SSR compile cache (e.g. anything imported transitively from a `.svelte` file); instead, use `setHandler` with a stable name so re-imports don't pile up listeners. Plain `.on()` is fine in your server entry, which is loaded once.

In production (`development: false`) the watcher never starts and `file:change` never emits. See `events` for the full payload reference.

### `mochiEvents` from Svelte SSR

The emitter is pinned on `globalThis`, so a subscription made from a `.svelte` file running on the server reaches the same instance the framework emits to. On the client, `mochiEvents` is a stub: `on`/`off`/`setHandler` are no-ops and `emit` logs a warning — the bus is server-only.

### HMR rebuild logger lines

The built-in logger (default for `Mochi.serve()`) prints a structured line per save so you can see what was rebuilt and how long it took:

- `BUILD` — one per page compiled, plus a summary line with total file count and duration. Note shows hydratable/server-island counts and SSR bundle size.
- `BNDL` — one per `buildClientBundle()` call. Note shows the entrypoint count and total output bytes.
- `HMR ` — one per rebuild cycle. Note shows the trigger (`file` / `css` / `svelte-config`), `pages=N` (recompiled pages), and `bundles=N` (calls to `buildClientBundle`).

Healthy `bundles=` for a non-CSS save is `1` — the bundle is deferred to a single trailing call after every page has recompiled. A higher number means a regression to per-page bundling, which is O(N²) work for N hydratable pages.

Do **NOT** silence the rebuild lines by disabling the whole logger; instead, pass `logger: { compile: false }` to `Mochi.serve()` to drop only the `BUILD` / `BNDL` / `HMR` lines.
