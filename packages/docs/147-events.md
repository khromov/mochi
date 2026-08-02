---
title: 'Events'
slug: events
description: 'Subscribe to framework lifecycle events like requests, WebSocket activity, and builds via a mitt emitter.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Events

Mochi exposes a process-wide [`mitt`](https://www.npmjs.com/package/mitt) emitter named `mochiEvents`. Subscribe from application code to feed metrics, audit logs, custom log destinations, or anything else that needs a structured view of server activity.

Event names use a `namespace:action` convention. Every key is in the typed `MochiEventMap`, so handlers receive a precise payload type without casts.

### `mochiEvents.on`

- [`request`](#request) — every HTTP request (page or API)
- [`ws:open`](#wsopen), [`ws:message`](#wsmessage), [`ws:close`](#wsclose) — WebSocket lifecycle
- [`sse:open`](#sseopen), [`sse:message`](#ssemessage), [`sse:close`](#sseclose) — Server-Sent Events lifecycle
- [`queue:added`](#queueadded), [`queue:active`](#queueactive), [`queue:completed`](#queuecompleted), [`queue:failed`](#queuefailed), [`queue:error`](#queueerror) — [background job](/docs/jobs/) lifecycle
- [`email:sent`](#emailsent), [`email:error`](#emailerror) — [transactional email](/docs/email/) delivery
- [`server:start`](#serverstart), [`server:stop`](#serverstop) — server lifecycle
- [`warmup:start`](#warmupstart), [`warmup:complete`](#warmupcomplete) — route warmup batch lifecycle (only with `warmup: true`)
- [`error`](#error) — page/api/action handler threw, response was an error page or `apiError`
- [`action:invoke`](#actioninvoke), [`action:complete`](#actioncomplete) — form action lifecycle
- [`compile:start`](#compilestart), [`compile:complete`](#compilecomplete), [`compile:error`](#compileerror) — Svelte SSR build
- [`recompile:start`](#recompilestart), [`recompile:complete`](#recompilecomplete) — dev rebuild cycle (one per save)
- [`client-bundle:complete`](#client-bundlecomplete) — hydratable client bundle finished
- [`island:error`](#islanderror) — a hydratable, server, or client-hydrate island errored
- [`captcha:verify`](#captchaverify) — a `<MochiCaptcha>` submission was verified or rejected
- [`file:change`](#filechange) — dev-only file watcher
- [`image:store`](#imagestore), [`image:delete`](#imagedelete) — [`<Image>`](/docs/images/) cache file written / removed
- `image:cache-sweep` — aggregate counts per janitor sweep (see [Images](/docs/images/))
- `cache:read`, `cache:revalidate` — see [Subscribing to cache events](/docs/cache/#subscribing-to-cache-events)

### Subscribing

Two patterns:

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('request', ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

<Callout type="warning">

**Keep async work out of handlers.** Handlers run synchronously and block the event emission chain; offload metrics, logging, and other I/O to a fire-and-forget async task so downstream handlers are not delayed.

</Callout>

### `mochiEvents.setHandler`

Use `setHandler(name, type, handler)` to register a named subscriber. It replaces any prior handler stored under the same `name`, so dev re-imports of the same module never pile up duplicate listeners.

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.setHandler('metrics:request', 'request', ({ status, duration }) => {
  metrics.timing('http.request', duration, { status });
});
```

Namespace `name` (`metrics:request`, not `request`) so unrelated subsystems do not silently evict each other.

### `hasSubscribers`

Use `hasSubscribers(name)` to skip payload construction when nobody is listening:

```ts
import { hasSubscribers, mochiEvents } from 'mochi-framework';

if (hasSubscribers('compile:error')) {
  mochiEvents.emit('compile:error', expensivePayload());
}
```

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

<Callout type="danger">

**Only set `proxy.requestIdHeader` for traffic you fully control.** Clients can spoof headers; if you trust untrusted traffic, attacker-controlled ids will correlate unrelated requests together in logs, breaking trace correlation.

</Callout>

### Event reference

Each event ships a typed payload. The fields below match `MochiEventMap` in `events.ts`.

#### `request`

Fires once per HTTP response, including CSRF rejects. Covers both `Mochi.page` and `Mochi.api` routes.

| Field       | Type                   | Notes                                                                                      |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `requestId` | `string`               | correlation id                                                                             |
| `kind`      | `'page' \| 'api'`      | which route type handled it                                                                |
| `method`    | `string`               | HTTP method                                                                                |
| `path`      | `string`               | URL pathname                                                                               |
| `status`    | `number`               | response status code                                                                       |
| `duration`  | `number`               | wall-clock ms, end-to-end                                                                  |
| `warmup`    | `boolean \| undefined` | `true` when issued by [route warmup](/docs/serve-options/#route-warmup), not a real client |

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

#### `queue:added`

Fires after a job is committed — the chain's entry job on `startChain`, and each continuation a `continueWith` creates. A rolled-back transaction emits nothing. See [Background jobs](/docs/jobs/).

| Field     | Type     | Notes                   |
| --------- | -------- | ----------------------- |
| `queue`   | `string` | chain (entry) type name |
| `jobId`   | `string` | job id                  |
| `jobName` | `string` | job type name           |

#### `queue:active`

Fires when the worker starts a job attempt.

| Field     | Type     | Notes                                   |
| --------- | -------- | --------------------------------------- |
| `queue`   | `string` | chain (entry) type name                 |
| `jobId`   | `string` | job id                                  |
| `jobName` | `string` | job type name                           |
| `attempt` | `number` | 1-based attempt number (1 on first run) |

#### `queue:completed`

Fires when a job attempt completes successfully.

| Field      | Type     | Notes                                 |
| ---------- | -------- | ------------------------------------- |
| `queue`    | `string` | chain (entry) type name               |
| `jobId`    | `string` | job id                                |
| `jobName`  | `string` | job type name                         |
| `attempt`  | `number` | attempt that succeeded                |
| `duration` | `number` | processing ms, measured from `active` |

#### `queue:failed`

Fires when a job's handler throws (once per failed attempt; the job retries with backoff).

| Field      | Type     | Notes                          |
| ---------- | -------- | ------------------------------ |
| `queue`    | `string` | chain (entry) type name        |
| `jobId`    | `string` | job id                         |
| `jobName`  | `string` | job type name                  |
| `attempt`  | `number` | attempt that failed            |
| `duration` | `number` | processing ms before the throw |
| `error`    | `string` | thrown error message           |

#### `queue:error`

Fires for a runtime-level error not tied to a specific attempt (a worker loop, state-adapter, or notify-adapter failure).

| Field   | Type     | Notes                                     |
| ------- | -------- | ----------------------------------------- |
| `queue` | `string` | chain type name, or `jobs` when unrelated |
| `error` | `string` | error message                             |

#### `email:sent`

Fires after `Mochi.email()` hands a message to its transport (or when the [`email:message` filter](/docs/extensions/#emailmessage) vetoes it). See [Email](/docs/email/).

| Field       | Type                                                   | Notes                                                               |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `to`        | `string[]`                                             | recipient addresses (as actually sent, post-filter)                 |
| `subject`   | `string`                                               | message subject                                                     |
| `transport` | `'smtp' \| 'custom' \| 'log' \| 'dev' \| 'suppressed'` | which transport delivered it; `'suppressed'` when the filter vetoed |
| `messageId` | `string \| undefined`                                  | provider/SMTP id, when the transport returns one                    |
| `duration`  | `number`                                               | send wall-clock in ms                                               |

#### `email:error`

Fires when a transport throws while sending. `Mochi.email()` re-throws after emitting.

| Field       | Type                                   | Notes                                    |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `to`        | `string[]`                             | recipient addresses                      |
| `cc`        | `string[] \| undefined`                | cc recipients, when the message had any  |
| `bcc`       | `string[] \| undefined`                | bcc recipients, when the message had any |
| `subject`   | `string`                               | message subject                          |
| `transport` | `'smtp' \| 'custom' \| 'log' \| 'dev'` | transport that failed                    |
| `error`     | `string`                               | error message                            |

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

#### `warmup:start`

Fires once when the [route warmup](/docs/serve-options/#route-warmup) batch begins, right after the server starts listening. Only emitted when `warmup: true` is set on `Mochi.serve()`.

| Field        | Type     | Notes                                 |
| ------------ | -------- | ------------------------------------- |
| `routeCount` | `number` | static page routes about to be warmed |

#### `warmup:complete`

Fires once after the [route warmup](/docs/serve-options/#route-warmup) batch finishes. Only emitted when `warmup: true` is set on `Mochi.serve()`.

| Field        | Type     | Notes                                    |
| ------------ | -------- | ---------------------------------------- |
| `routeCount` | `number` | static page routes warmed                |
| `errorCount` | `number` | warmup invocations that threw or 5xx'd   |
| `durationMs` | `number` | wall-clock ms for the whole warmup batch |

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

#### `captcha:verify`

Fires when [`verifyCaptcha()`](/docs/captcha/) finishes, pass or fail. `verifyCaptcha()` deliberately returns one generic message to the client so a bot can't tell the failure modes apart — this event is where the real cause stays visible, which makes it the hook for spam dashboards and alerting on a spike of rejections.

| Field    | Type                  | Notes                                                                     |
| -------- | --------------------- | ------------------------------------------------------------------------- |
| `ok`     | `boolean`             | whether verification passed                                               |
| `reason` | `MochiCaptchaReason`  | `'ok' \| 'malformed' \| 'expired' \| 'too-fast' \| 'bad-pow' \| 'replay'` |
| `bits`   | `number \| undefined` | difficulty sealed in the token; absent if it never opened                 |
| `ageMs`  | `number \| undefined` | token age at verification; absent if it never opened                      |

```ts
mochiEvents.on('captcha:verify', ({ ok, reason }) => {
  if (!ok) {
    metrics.increment('captcha.rejected', { reason });
  }
});
```

#### `island:error`

Fires when an island fails — server-island render, hydratable SSR render, or client-side hydration. The framework still ships an error placeholder; this event lets you observe it.

| Field           | Type                                           | Notes                                             |
| --------------- | ---------------------------------------------- | ------------------------------------------------- |
| `componentName` | `string`                                       | island component identifier                       |
| `islandId`      | `string \| undefined`                          | envelope id; set for `'server'`, else `undefined` |
| `kind`          | `'hydratable' \| 'server' \| 'client-hydrate'` | which lifecycle stage failed                      |
| `message`       | `string`                                       | error message                                     |
| `stack`         | `string \| undefined`                          | stack trace, populated in dev only                |

#### `file:change`

Fires from the dev file watcher (chokidar). Production builds do not run the watcher, so this event never emits there.

| Field  | Type                  | Notes                                                      |
| ------ | --------------------- | ---------------------------------------------------------- |
| `path` | `string`              | absolute path of the changed file                          |
| `type` | `MochiFileChangeType` | `'add' \| 'change' \| 'unlink' \| 'addDir' \| 'unlinkDir'` |

#### `image:store`

Fires when the [`<Image>`](/docs/images/) cache commits a file to disk: a downloaded full-size `original`, a resized `variant`/thumbnail, or a ThumbHash blur `placeholder`. Emitted once per regeneration (concurrent misses coalesce), so it's the hook for mirroring cache writes to durable storage like S3.

| Field         | Type                                       | Notes                                                  |
| ------------- | ------------------------------------------ | ------------------------------------------------------ |
| `kind`        | `'original' \| 'variant' \| 'placeholder'` | which entry type was written                           |
| `src`         | `string`                                   | the image source (URL/key) this entry derives from     |
| `path`        | `string`                                   | absolute path of the file just committed on disk       |
| `id`          | `string`                                   | `variantId` for `variant`; `originalId(src)` otherwise |
| `size`        | `number`                                   | bytes written                                          |
| `contentType` | `string`                                   | authoritative content type; `''` for `placeholder`     |
| `width`       | `number`                                   | pixel width; `0` for `original` and `placeholder`      |
| `height`      | `number`                                   | pixel height; `0` for `original` and `placeholder`     |
| `format`      | `string`                                   | encoded format (e.g. `'webp'`); `''` for the two above |

Read the file **synchronously at the top of the handler** — it provably exists at emit time — then offload the upload to a fire-and-forget task. A lazy `await readFile(path)` inside a slow handler could race the janitor sweep and miss the file.

```ts
import { readFileSync } from 'node:fs';
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('image:store', ({ kind, src, path, contentType }) => {
  const body = readFileSync(path); // sync: the file is guaranteed present now
  void s3.putObject({ Bucket, Key: `img/${kind}/${src}`, Body: body, ContentType: contentType });
});
```

<Callout type="warning">

**Keep async work out of handlers.** Handlers run synchronously and block the emission chain; read the bytes synchronously, then hand the upload to an async task so downstream handlers are not delayed.

</Callout>

#### `image:delete`

Fires when the `<Image>` cache removes a file from disk — evicted by the janitor sweep, superseded by a newer generation, or explicitly invalidated. Pair it with `image:store` to keep an S3 mirror in sync. Bulk `invalidateSrc()` only emits per-file deletes while a subscriber is registered.

| Field    | Type                                         | Notes                                                                                                          |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `kind`   | `'original' \| 'variant' \| 'placeholder'`   | which entry type was removed                                                                                   |
| `src`    | `string`                                     | the image source this entry derived from                                                                       |
| `path`   | `string`                                     | absolute path of the removed file                                                                              |
| `id`     | `string`                                     | same id scheme as `image:store`                                                                                |
| `size`   | `number`                                     | bytes reclaimed (`0` if the file was already gone)                                                             |
| `reason` | `'evicted' \| 'superseded' \| 'invalidated'` | `evicted` = past its window (sweep); `superseded` = newer generation; `invalidated` = explicit invalidate call |

```ts
mochiEvents.on('image:delete', ({ kind, src, path }) => {
  void s3.deleteObject({ Bucket, Key: `img/${kind}/${src}` });
});
```

#### `cache:read`, `cache:revalidate`

Emitted by `MochiCache` — see [Subscribing to cache events](/docs/cache/#subscribing-to-cache-events) for payloads and a worked subscriber.

### Custom events

`mochiEvents` is a plain mitt emitter — `emit` your own keys on it for quick experiments. Custom keys are absent from `MochiEventMap`, so handlers and emit sites lose typing.

### Built-in subscribers

`logger()` (see `logger`) already prints `request`, `ws:*`, `sse:*`, `server:*`, `error`, and `cache:revalidate` lines. Pass `{ cache: 'verbose' }` to also print every `cache:read`, or `{ cache: false }` to silence cache logging entirely.

<SeeItInAction
demos={[{ href: "/demos/cache-events/", title: "Cache Events", hook: "How cache events work — subscribe to MochiCache lifecycle events (hit, miss, set, evict) through mochiEvents for observability." }]}
/>
