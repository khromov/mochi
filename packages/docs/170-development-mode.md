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

`MODE` is a user-space convention — Mochi reads only `options.development`. Passing `development` explicitly via your entry file keeps test runners and one-off scripts on the same behaviour.

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

### Component hot-reload

Svelte component changes are picked up automatically via the SSR compile cache — edit a `.svelte` file and the browser will refresh.

### Route handler HMR

**Route handler code** — `Mochi.api` handlers, `serverProps` resolvers, form `actions`, `Mochi.ws` handlers, `Mochi.sse` handlers — is hot-swapped without a restart. The watcher builds your entry (`src/index.ts`) to discover its transitive dependencies; when any of them changes it rebuilds the entry, re-reads the `routes` from its `Mochi.serve()` call, and updates the running server in place.

Adding, removing, and editing route patterns all work without a restart — new routes are registered, removed routes are cleaned up, and the route table is reloaded on the fly. WebSocket connections stay open; the browser is notified to reload so pages pick up updated `serverProps`.

<Callout type="warning">
Do <strong>NOT</strong> rely on module-scoped mutable state surviving a route HMR cycle. Each reload re-evaluates the <em>entire entry dependency graph</em>, resetting any <code>let</code> / <code>const</code> declared at module scope. Move shared state into a module the entry imports (an in-memory store or database), and keep top-level side effects (e.g. cache priming) idempotent — they re-run on every reload.
</Callout>

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

<Callout type="warning">

**Use `setHandler` for event handlers in SSR-recompiled code.** `.on()` from modules re-imported by the SSR compile cache (e.g., transitively from `.svelte` files) will pile up duplicate listeners on each recompilation, leaking memory. `setHandler` with a stable name replaces the subscription idempotently. `.on()` is safe only in your server entry, which is loaded once.

</Callout>

In production (`development: false`) the watcher never starts and `file:change` never emits. See `events` for the full payload reference.

### `mochiEvents` from Svelte SSR

The emitter is pinned on `globalThis`, so a subscription made from a `.svelte` file running on the server reaches the same instance the framework emits to. On the client, `mochiEvents` is a stub: `on`/`off`/`setHandler` are no-ops and `emit` logs a warning — the bus is server-only.

### HMR rebuild logger lines

The built-in logger (default for `Mochi.serve()`) prints a structured line per save so you can see what was rebuilt and how long it took:

- `BUILD` — one per page compiled, plus a summary line with total file count and duration. Note shows hydratable/server-island counts and SSR bundle size.
- `BNDL` — one per `buildClientBundle()` call. Note shows the entrypoint count and total output bytes.
- `HMR ` — one per rebuild cycle. Note shows the trigger (`file` / `css` / `svelte-config`), `pages=N` (recompiled pages), and `bundles=N` (calls to `buildClientBundle`).

Healthy `bundles=` for a non-CSS save is `1` — the bundle is deferred to a single trailing call after every page has recompiled. A higher number means a regression to per-page bundling, which is O(N²) work for N hydratable pages.

<Callout type="warning">

**Use `logger: { compile: false }` to suppress rebuild lines.** Pass this option to `Mochi.serve()` to drop only `BUILD` / `BNDL` / `HMR` output; disabling the whole logger loses other diagnostics.

</Callout>
