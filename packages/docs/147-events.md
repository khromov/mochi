---
title: 'Events'
slug: events
description: 'Subscribe to framework lifecycle events like requests, WebSocket activity, and builds via a mitt emitter.'
---

## Events

Mochi exposes a process-wide [`mitt`](https://www.npmjs.com/package/mitt) emitter named `mochiEvents`. Subscribe from application code to feed metrics, audit logs, custom log destinations, or anything else that needs a structured view of server activity.

Event names use a `namespace:action` convention. Every key is in the typed `MochiEventMap`, so handlers receive a precise payload type without casts.

### `mochiEvents.on`

- [`request`](#request) — every HTTP request (page or API)
- [`ws:open`](#wsopen), [`ws:message`](#wsmessage), [`ws:close`](#wsclose) — WebSocket lifecycle
- [`sse:open`](#sseopen), [`sse:message`](#ssemessage), [`sse:close`](#sseclose) — Server-Sent Events lifecycle
- [`server:start`](#serverstart), [`server:stop`](#serverstop) — server lifecycle
- [`error`](#error) — page/api/action handler threw, response was an error page or `apiError`
- [`action:invoke`](#actioninvoke), [`action:complete`](#actioncomplete) — form action lifecycle
- [`compile:start`](#compilestart), [`compile:complete`](#compilecomplete), [`compile:error`](#compileerror) — Svelte SSR build
- [`recompile:start`](#recompilestart), [`recompile:complete`](#recompilecomplete) — dev rebuild cycle (one per save)
- [`client-bundle:complete`](#client-bundlecomplete) — hydratable client bundle finished
- [`island:error`](#islanderror) — a hydratable, server, or client-hydrate island errored
- [`file:change`](#filechange) — dev-only file watcher
- `cache:read`, `cache:revalidate` — see [Subscribing to cache events](/docs/cache/#subscribing-to-cache-events)

### Subscribing

Two patterns:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('request', ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

Handlers run synchronously. Do **NOT** `await` long-running work inside a handler; instead, fire-and-forget to your metrics or log client so the next emission is not stalled.

### `mochiEvents.setHandler`

Use `setHandler(name, type, handler)` to register a named subscriber. It replaces any prior handler stored under the same `name`, so dev re-imports of the same module never pile up duplicate listeners.

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('metrics:request', 'request', ({ status, duration }) => {
  metrics.timing('http.request', duration, { status });
});
```

Namespace `name` (`metrics:request`, not `request`) so unrelated subsystems do not silently evict each other.

Do **NOT** mix `setHandler` with `mochiEvents.off()` for the same name; instead, call `setHandler(name, type, noop)` or rely on a fresh `setHandler(name, …)` to swap the handler — the name table is maintained only by `setHandler`.

### `hasSubscribers`

Use `hasSubscribers(name)` to skip payload construction when nobody is listening:

```ts
import { hasSubscribers, mochiEvents } from 'mochi-framework';

if (hasSubscribers('compile:error')) {
  mochiEvents.emit('compile:error', expensivePayload());
}
```

Do **NOT** wrap every emission in `hasSubscribers`; instead, reach for it only when the payload involves loops, allocations, or stack capture. The built-in events emit unconditionally — their object literals are below noise.

### `requestId` correlation

Every HTTP request carries a stable `requestId` on `request`, `error`, `action:invoke`, and `action:complete`. Use it to stitch a 500 trace together (the `error` payload + the matching `request` payload). The same id is on the request context:

```ts
import { getRequestContext } from 'mochi-framework';

const { requestId } = getRequestContext();
```

To honour an upstream id from a trusted reverse proxy, set `proxy.requestIdHeader` on `Mochi.serve()`:

```ts
Mochi.serve({
  proxy: { requestIdHeader: 'X-Request-Id' },
  // …
});
```

Do **NOT** enable `proxy.requestIdHeader` for traffic you do not control; instead, leave it unset so the framework generates an id with `nanoid` — clients can spoof any header, smearing log lines for unrelated requests together.

### Event reference

Each event ships a typed payload. The fields below match `MochiEventMap` in `events.ts`.

#### `request`

Fires once per HTTP response, including CSRF rejects. Covers both `Mochi.page` and `Mochi.api` routes.

| Field       | Type              | Notes                       |
| ----------- | ----------------- | --------------------------- |
| `requestId` | `string`          | correlation id              |
| `kind`      | `'page' \| 'api'` | which route type handled it |
| `method`    | `string`          | HTTP method                 |
| `path`      | `string`          | URL pathname                |
| `status`    | `number`          | response status code        |
| `duration`  | `number`          | wall-clock ms, end-to-end   |

```ts
mochiEvents.on('request', ({ kind, method, path, status, duration }) => {
  if (status >= 500) alerts.fire({ kind, method, path, status, duration });
});
```

#### `ws:open`

Fires after a successful WebSocket upgrade.

| Field      | Type     | Notes                               |
| ---------- | -------- | ----------------------------------- |
| `path`     | `string` | URL pathname of the upgrade request |
| `duration` | `number` | ms spent in the upgrade handler     |

#### `ws:message`

Fires for every inbound WebSocket frame, after the user `message` handler returns.

| Field  | Type                 | Notes                         |
| ------ | -------------------- | ----------------------------- |
| `path` | `string`             | URL pathname                  |
| `size` | `number`             | bytes (text length or buffer) |
| `type` | `'text' \| 'binary'` | frame kind                    |

#### `ws:close`

Fires when a WebSocket connection closes.

| Field      | Type     | Notes                       |
| ---------- | -------- | --------------------------- |
| `path`     | `string` | URL pathname                |
| `duration` | `number` | ms the socket was open      |
| `code`     | `number` | WebSocket close code        |
| `reason`   | `string` | close reason (may be empty) |

#### `sse:open`

Fires when an SSE stream starts (the `ReadableStream` is pulled by the runtime).

| Field  | Type     | Notes        |
| ------ | -------- | ------------ |
| `path` | `string` | URL pathname |

#### `sse:message`

Fires per `stream.send()` inside an SSE handler.

| Field   | Type                  | Notes                                   |
| ------- | --------------------- | --------------------------------------- |
| `path`  | `string`              | URL pathname                            |
| `size`  | `number`              | bytes written for the data line         |
| `event` | `string \| undefined` | optional named event passed to `send()` |

#### `sse:close`

Fires when the SSE stream closes (client disconnect or explicit close).

| Field      | Type     | Notes                  |
| ---------- | -------- | ---------------------- |
| `path`     | `string` | URL pathname           |
| `duration` | `number` | ms the stream was open |

#### `server:start`

Fires once after `Bun.serve()` binds the listening socket.

| Field         | Type                                                     | Notes                             |
| ------------- | -------------------------------------------------------- | --------------------------------- |
| `port`        | `number \| undefined`                                    | bound TCP port (absent over Unix) |
| `hostname`    | `string \| undefined`                                    | bound hostname if any             |
| `development` | `boolean`                                                | dev or prod mode                  |
| `routes`      | `{ page: number; api: number; ws: number; sse: number }` | route counts by kind              |

#### `server:stop`

Fires when the server is shutting down via `SIGTERM`/`SIGINT`, after the `mochi:shutdown` hook has run.

| Field    | Type                                 | Notes                       |
| -------- | ------------------------------------ | --------------------------- |
| `reason` | `'signal'`                           | what initiated the shutdown |
| `signal` | `'SIGTERM' \| 'SIGINT' \| undefined` | the signal received         |

#### `error`

Fires when a page, API, or form action handler throws and the framework returns an error response. Useful for routing exceptions to Sentry/Rollbar/Datadog without monkey-patching.

| Field        | Type                          | Notes                                             |
| ------------ | ----------------------------- | ------------------------------------------------- |
| `requestId`  | `string`                      | correlates with the matching `request`            |
| `kind`       | `'page' \| 'api' \| 'action'` | which handler threw                               |
| `path`       | `string`                      | URL pathname + search                             |
| `method`     | `string`                      | HTTP method                                       |
| `status`     | `number`                      | final response status                             |
| `message`    | `string`                      | error message                                     |
| `stack`      | `string \| undefined`         | stack trace, populated in dev only                |
| `actionName` | `string \| undefined`         | form action name; present only when `kind=action` |

```ts
mochiEvents.on('error', ({ kind, path, status, message, stack }) => {
  Sentry.captureException(new Error(message), { tags: { kind, path, status }, contexts: { stack } });
});
```

#### `action:invoke`

Fires immediately before a form action handler runs. Pairs with `action:complete` via `requestId`.

| Field        | Type     | Notes                                |
| ------------ | -------- | ------------------------------------ |
| `requestId`  | `string` | correlates with `action:complete`    |
| `path`       | `string` | URL pathname + search                |
| `actionName` | `string` | action name (`'default'` if unnamed) |

#### `action:complete`

Fires after a form action returns (or throws). One emission per invocation, regardless of outcome.

| Field        | Type                                           | Notes                           |
| ------------ | ---------------------------------------------- | ------------------------------- |
| `requestId`  | `string`                                       | correlates with `action:invoke` |
| `path`       | `string`                                       | URL pathname + search           |
| `actionName` | `string`                                       | action name                     |
| `result`     | `'success' \| 'fail' \| 'redirect' \| 'error'` | outcome category                |
| `status`     | `number \| undefined`                          | set for `fail` and `redirect`   |

#### `compile:start`

Fires before each Svelte SSR compile (skipped on cache hit).

| Field  | Type     | Notes                       |
| ------ | -------- | --------------------------- |
| `path` | `string` | absolute path of the source |

#### `compile:complete`

Fires after a successful compile.

| Field               | Type     | Notes                                    |
| ------------------- | -------- | ---------------------------------------- |
| `path`              | `string` | absolute path of the source              |
| `ssrSizeBytes`      | `number` | size of the SSR bundle                   |
| `hydratableCount`   | `number` | hydratable islands found                 |
| `serverIslandCount` | `number` | server islands found                     |
| `durationMs`        | `number` | wall-clock time spent inside `compile()` |

#### `compile:error`

Fires when `Bun.build` rejects a Svelte source. The framework still throws after emitting; the event exists for tooling that wants the structured logs.

| Field     | Type                                                                        | Notes                            |
| --------- | --------------------------------------------------------------------------- | -------------------------------- |
| `path`    | `string`                                                                    | source that failed               |
| `message` | `string`                                                                    | top-line error message           |
| `logs`    | `Array<{ file?: string; line?: number; column?: number; message: string }>` | per-message diagnostics from Bun |

#### `recompile:start`

Fires from the dev watcher before a rebuild cycle begins. Production builds never emit. Wraps either a full SSR rebuild (`trigger: 'file' | 'svelte-config'`) or the CSS-only fast path (`trigger: 'css'`).

| Field       | Type                                 | Notes                                            |
| ----------- | ------------------------------------ | ------------------------------------------------ |
| `trigger`   | `'file' \| 'css' \| 'svelte-config'` | which watcher path fired                         |
| `path`      | `string`                             | file whose change triggered the rebuild          |
| `pageCount` | `number`                             | pages about to be rebuilt (`0` for the CSS path) |

#### `recompile:complete`

Fires after the matching `recompile:start`, once the rebuild has finished and clients have been notified to reload.

`clientBundleCount` is the count of `buildClientBundle()` calls inside the cycle — for the typical `'file'` trigger it should be `1` (or `0` if no hydratables are registered). A value `> 1` means the registry's bundle deferral isn't kicking in and you've regressed to per-page bundling.

| Field               | Type                                 | Notes                                          |
| ------------------- | ------------------------------------ | ---------------------------------------------- |
| `trigger`           | `'file' \| 'css' \| 'svelte-config'` | matches `recompile:start`                      |
| `path`              | `string`                             | matches `recompile:start`                      |
| `pageCount`         | `number`                             | pages that were rebuilt                        |
| `clientBundleCount` | `number`                             | `buildClientBundle()` invocations during cycle |
| `durationMs`        | `number`                             | wall-clock ms for the whole cycle              |

```ts
mochiEvents.on('recompile:complete', ({ trigger, pageCount, clientBundleCount, durationMs }) => {
  logger.info(`HMR ${trigger} pages=${pageCount} bundles=${clientBundleCount} ${durationMs.toFixed(0)}ms`);
});
```

#### `client-bundle:complete`

Fires whenever the registry rebuilds the hydratable client bundle (one Bun.build over `HydratableIsland.ts` plus a per-component virtual entrypoint). Production builds emit once at startup; dev mode emits during `recompileAll()` and on lazy first-hit compiles for server islands.

| Field         | Type     | Notes                                                    |
| ------------- | -------- | -------------------------------------------------------- |
| `entryCount`  | `number` | entrypoints fed to Bun.build (bootstrap + per-component) |
| `outputBytes` | `number` | sum of all output sizes (JS + CSS) from the bundle       |
| `durationMs`  | `number` | wall-clock ms inside `buildClientBundle()`               |

#### `island:error`

Fires when an island fails — server-island render, hydratable SSR render, or client-side hydration. The framework still ships an error placeholder; this event lets you observe it.

| Field           | Type                                           | Notes                              |
| --------------- | ---------------------------------------------- | ---------------------------------- |
| `componentName` | `string`                                       | island component identifier        |
| `islandId`      | `string \| undefined`                          | DOM `island-id` if known           |
| `kind`          | `'hydratable' \| 'server' \| 'client-hydrate'` | which lifecycle stage failed       |
| `message`       | `string`                                       | error message                      |
| `stack`         | `string \| undefined`                          | stack trace, populated in dev only |

#### `file:change`

Fires from the dev file watcher. Production builds do not run the watcher, so this event never emits there.

| Field  | Type                  | Notes                                                      |
| ------ | --------------------- | ---------------------------------------------------------- |
| `path` | `string`              | absolute path of the changed file                          |
| `type` | `MochiFileChangeType` | `'add' \| 'change' \| 'unlink' \| 'addDir' \| 'unlinkDir'` |

#### `cache:read`, `cache:revalidate`

Emitted by `MochiCache` — see [Subscribing to cache events](/docs/cache#subscribing-to-cache-events) for payloads and a worked subscriber.

### Custom events

`mochiEvents` is a plain mitt emitter — `emit` your own keys on it for quick experiments. Custom keys are absent from `MochiEventMap`, so handlers and emit sites lose typing.

Do **NOT** use `mochiEvents` for application events you own; instead, construct a separate emitter you control so the typed map stays accurate to the framework's surface.

### Built-in subscribers

`logger()` (see `logger`) already prints `request`, `ws:*`, `sse:*`, `server:*`, `error`, and `cache:revalidate` lines. Pass `{ cache: 'verbose' }` to also print every `cache:read`, or `{ cache: false }` to silence cache logging entirely.
