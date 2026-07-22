---
title: 'Logging'
slug: logging
description: 'An isomorphic, level-gated logger that works in server, SSR, and client contexts.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Logging

Mochi exposes a single isomorphic `logger` with five standard methods. The same import works on the server, in SSR, in hydrated Svelte components, and in vanilla web components — and it's gated by a configurable level set on `Mochi.serve()`.

```ts
import { logger } from 'mochi-framework';

logger.error('boom');
logger.warn('careful');
logger.info('starting up');
logger.log('verbose detail');
logger.debug('asset request');
```

Methods map to `console.error` / `console.warn` / `console.info` / `console.log` / `console.debug`. Each line is prefixed with a coloured `[mochi]`. Calls below the configured level are no-ops with negligible overhead.

### Log level

```ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  routes,
  logger: { level: 'warn' },
});
```

`level` accepts `'silent' | 'error' | 'warn' | 'info' | 'log' | 'debug'`. A method runs when its severity is at or above the active level, so `'warn'` lets `error` and `warn` through while suppressing `info`, `log`, and `debug`.

| Level      | What you see                                                                                   | When to reach for it                            |
| ---------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `'silent'` | Nothing — no boot line, no requests, no errors                                                 | Tests; CLI scripts that don't want any noise    |
| `'debug'`  | Everything `'log'` shows plus per-asset request lines (CSS, JS, images) and fallbacks          | Investigating asset fetches or unmatched routes |
| `'log'`    | Adds chatty client-side hydration traces and other verbose detail                              | Debugging hydration / island lifecycle issues   |
| `'info'`   | Boot line, page/api/file requests, file-change notifications, plus warnings and errors         | Default in development                          |
| `'warn'`   | Slow requests, 5xx responses, queue lifecycle, deprecations, recoverable problems, plus errors | Default in production                           |
| `'error'`  | Only handler failures — `logger.error` calls and unhandled exceptions                          | Production with a separate alerting pipeline    |

Which severity each event lands on is a framework default — request lines are `info`, asset and image lines are `debug`, and so on. Remap them per app with the [`consoleLogger:level` filter](/docs/extensions/): promote the events you care about, demote the ones you don't, without moving the global level.

If `level` is omitted, the default is picked from the `development` flag you pass to `Mochi.serve()`:

| `Mochi.serve({ development })` | Default level |
| ------------------------------ | ------------- |
| `true`                         | `'info'`      |
| `false` (or omitted)           | `'warn'`      |

A common pattern is to drive `development` from an env var so the same `index.ts` handles both:

```ts
await Mochi.serve({
  development: process.env.MODE === 'development',
  routes,
});
```

The level applies on both sides: the server captures it once at startup, and the same value is shipped to the browser via a tiny inline script so client-side `logger` calls (e.g. inside hydrated islands) honour it too. Reload the page after changing the config to pick up a new level on the client.

<Callout type="warning">

`level: 'silent'` really means silent — including the `BOOT` and `STOP` lines printed by the built-in formatter. If you want lifecycle events delivered to your own subscribers but no console output, set `logger: { enabled: false }` instead. That keeps the event bus alive while disabling the formatter.

</Callout>

### Method semantics

- `logger.error` (red) — failures the operator should see.
- `logger.warn` (yellow) — slow requests, 5xx responses, queue lifecycle (`added`/`completed`/`failed`), deprecations, recoverable problems.
- `logger.info` (green) — boot, page/api request lines, file-change notifications.
- `logger.log` (dim) — verbose / trace output, e.g. hydration lifecycle. Off unless `level: 'log'` or `'debug'`.
- `logger.debug` (dim) — high-volume, low-signal lines like asset requests and fallback routes. Off unless `level: 'debug'`.

### Setting the level at runtime

```ts
import { setLogLevel, getLogLevel } from 'mochi-framework';

setLogLevel('error');
getLogLevel(); // 'error'
```

`setLogLevel` is exported for niche cases — toggling verbosity from a feature flag, lifting silence inside a debugging route. The serve-time config is the right place for normal use.

<Callout type="warning">

`setLogLevel` only updates the bundle it's called from. The server, the main client bundle, and each island bundle each carry their own copy of the level — they're seeded consistently at startup, so this rarely matters. But a runtime call from inside one island won't change gating in other islands or on the server. For a global change, update `Mochi.serve({ logger: { level } })` and reload.

</Callout>

### Relationship to `mochiEvents`

The event bus (`mochiEvents`) is a separate concern: it carries structured payloads to any subscriber you wire up, regardless of console output. The built-in `consoleLogger()` — the thing that prints request lines like `GET /foo 200 12ms` — is just one consumer subscribing to those events and calling `logger.info` / `logger.warn` per event. Plug Sentry, OpenTelemetry, or your own pipeline directly into `mochiEvents`; use `logger` for ad-hoc messages.

<SeeItInAction
demos={[{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents and log them to the server console." }]}
/>
