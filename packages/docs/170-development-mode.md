---
title: 'Development mode'
slug: development-mode
description: 'What the development flag enables: debug bar, error overlay, and bundle stats.'
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

- **Debug bar** — `<div id="mochi-dev-toolbar">` is injected into every page and the per-request payload is seeded onto `window.__mochi_debug`.
- **Error overlay** — build and runtime errors render via `buildErrorOverlay` on top of the page (dev only).
- **Error console script** — the same errors are also pushed through `console.error` via `buildErrorScript` (runs in dev and prod).
- **Bundle stats** — a JSON report is served at `${assetPrefix}/client/stats` (default `/_mochi/client/stats`).
- **Stack traces on `error` events** — `error` payloads include `stack`; in production `stack` is `undefined`.

<Callout type="warning">
Never run `development: true` in production. Stack traces leak through the `error` event and the error overlay.
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

### `mochiEvents` from Svelte SSR

The emitter is pinned on `globalThis`, so a subscription made from a `.svelte` file running on the server reaches the same instance the framework emits to. On the client, `mochiEvents` is a stub: `on`/`off`/`setHandler` are no-ops and `emit` logs a warning — the bus is server-only.
