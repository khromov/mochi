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

Mochi exposes one isomorphic `logger` with five methods. The same import works on the server, in SSR, in hydrated Svelte components, and in vanilla web components. A configurable level set on `Mochi.serve()` gates it.

```ts
import { logger } from 'mochi-framework';

logger.error('boom');
logger.warn('careful');
logger.info('starting up');
logger.log('verbose detail');
logger.debug('asset request');
```

Methods map to `console.error` / `console.warn` / `console.info` / `console.log` / `console.debug`. Each line is prefixed with a coloured `[mochi]`. A call below the configured level is a no-op with negligible overhead.

### Log level

```ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3333,
  routes,
  logger: { level: 'warn' },
});
```

`level` accepts `'silent' | 'error' | 'warn' | 'info' | 'log' | 'debug'`. A method runs when its severity is at or above the active level. So `'warn'` lets `error` and `warn` through and suppresses `info`, `log`, and `debug`.

| Level      | What you see                                                                          | When to use                                     |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `'silent'` | Nothing — no boot line, no requests, no errors                                        | Tests; CLI scripts that want no noise           |
| `'debug'`  | Everything `'log'` shows, plus per-asset request lines and fallbacks                  | Investigating asset fetches or unmatched routes |
| `'log'`    | Adds chatty client-side hydration traces and other verbose detail                     | Debugging hydration / island lifecycle          |
| `'info'`   | Boot line, page/api/file requests, file-change notifications, plus warnings/errors    | Default in development                          |
| `'warn'`   | Slow requests, 5xx responses, queue lifecycle, deprecations, recoverable problems     | Default in production                           |
| `'error'`  | Only handler failures and unhandled exceptions                                        | Production with a separate alerting pipeline    |

Which severity each event lands on is a framework default. Remap them per app with the [`consoleLogger:level` filter](/docs/extensions/).

If `level` is omitted, Mochi picks the default from the `development` flag: `'info'` when `development: true`, `'warn'` otherwise.

A common pattern drives `development` from an env var so one `index.ts` handles both:

```ts
await Mochi.serve({
  development: process.env.MODE === 'development',
  routes,
});
```

The level applies on both server and client. The server sends its configured level to the browser, so client-side `logger` calls honour it too. Reload the page after changing the config to pick up a new level on the client.

<Callout type="warning">

`level: 'silent'` really means silent, including the `BOOT` and `STOP` lines. To deliver lifecycle events to your own subscribers with no console output, set `logger: { enabled: false }` instead. That keeps the event bus alive and disables the formatter.

</Callout>

### Setting the level at runtime

```ts
import { setLogLevel, getLogLevel } from 'mochi-framework';

setLogLevel('error');
getLogLevel(); // 'error'
```

`setLogLevel` is for niche cases such as toggling verbosity from a feature flag. The serve-time config is the right place for normal use.

<Callout type="warning">

`setLogLevel` updates only the bundle it is called from. The server, the main client bundle, and each island bundle carry their own copy of the level. They are seeded consistently at startup. For a global change, update `Mochi.serve({ logger: { level } })` and reload.

</Callout>

### Relationship to `mochiEvents`

The event bus (`mochiEvents`) carries structured payloads to any subscriber you wire up, regardless of console output. The built-in `consoleLogger()` — the thing that prints request lines like `GET /foo 200 12ms` — is one consumer that subscribes to those events and calls `logger.info` / `logger.warn` per event. Plug Sentry, OpenTelemetry, or your own pipeline directly into `mochiEvents`. Use `logger` for ad-hoc messages.

<SeeItInAction
demos={[{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents." }]}
/>
