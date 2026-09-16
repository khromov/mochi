---
title: 'Events'
slug: events
ogTitle: 'The framework lifecycle event bus'
description: 'Subscribe to framework lifecycle events like requests, WebSocket activity, and builds via a mitt emitter.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Events

Mochi exposes a process-wide [`mitt`](https://www.npmjs.com/package/mitt) emitter named `mochiEvents`. Subscribe from application code to feed metrics, audit logs, custom log destinations, or anything else that needs a structured view of server activity.

Event names use a `namespace:action` convention. Every key is in the typed `MochiEventMap`, so handlers receive a precise payload type without casts.

### Event index

- [`request`](#request) — every HTTP request (page or API)
- [`ws:open`](#wsopen), [`ws:message`](#wsmessage), [`ws:close`](#wsclose) — WebSocket lifecycle
- [`sse:open`](#sseopen), [`sse:message`](#ssemessage), [`sse:close`](#sseclose) — Server-Sent Events lifecycle
- [`queue:added`](#queueadded), [`queue:active`](#queueactive), [`queue:completed`](#queuecompleted), [`queue:failed`](#queuefailed), [`queue:error`](#queueerror) — [background job](/docs/queues/) lifecycle
- `cron:scheduled` — a [scheduled job](/docs/scheduled-jobs/) was registered (its runs surface through `queue:*` on the job name)
- [`email:sent`](#emailsent), [`email:error`](#emailerror) — [transactional email](/docs/email/) delivery
- [`server:start`](#serverstart), [`server:stop`](#serverstop) — server lifecycle
- [`warmup:start`](#warmupstart), [`warmup:complete`](#warmupcomplete) — route warmup batch (only with `warmup: true`)
- [`dictionary:ready`](#dictionaryready) — navigation dictionary published (only with `compressionDictionary` enabled)
- [`error`](#error) — a page/api/action handler threw
- [`action:invoke`](#actioninvoke), [`action:complete`](#actioncomplete) — form action lifecycle
- [`compile:start`](#compilestart), [`compile:complete`](#compilecomplete), [`compile:error`](#compileerror) — Svelte SSR build
- [`recompile:start`](#recompilestart), [`recompile:complete`](#recompilecomplete) — dev rebuild cycle
- [`recompile:module-churn`](#recompilemodule-churn) — entry re-imported many times in a dev session (resource-leak warning)
- [`client-bundle:complete`](#client-bundlecomplete) — hydratable client bundle finished
- [`island:error`](#islanderror) — an island errored
- [`captcha:verify`](#captchaverify) — a `<MochiCaptcha>` submission was verified or rejected
- [`file:change`](#filechange) — dev-only file watcher
- [`image:store`](#imagestore), [`image:delete`](#imagedelete) — [`<Image>`](/docs/images/) cache activity
- `image:cache-sweep` — aggregate counts per janitor sweep (see [Images](/docs/images/))
- `cache:read`, `cache:revalidate` — see [Cache events](/docs/cache/#subscribing-to-cache-events)
- `memory:pressure` — the OS reported low memory; fires before the cache drain so other subsystems can reclaim too (see [Cache](/docs/cache/#memory-pressure))
- `cache:pressure` — the OS reported low memory and in-memory caches were drained (see [Cache](/docs/cache/#memory-pressure))

### Subscribing

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('request', ({ method, path, status, duration }) => {
  metrics.timing('http.request', duration, { method, path, status });
});
```

<Callout type="warning">

**Keep async work out of handlers.** Handlers run synchronously and block the emission chain. Offload metrics, logging, and I/O to a fire-and-forget async task so downstream handlers are not delayed.

</Callout>

### `mochiEvents.setHandler`

Use `setHandler(name, type, handler)` to register a named subscriber. It replaces any prior handler stored under the same `name`, so dev re-imports never pile up duplicate listeners.

```ts
mochiEvents.setHandler('metrics:request', 'request', ({ status, duration }) => {
  metrics.timing('http.request', duration, { status });
});
```

Namespace `name` (`metrics:request`, not `request`) so unrelated subsystems do not evict each other.

### `hasSubscribers`

Use `hasSubscribers(name)` to skip payload construction when nobody is listening:

```ts
import { hasSubscribers, mochiEvents } from 'mochi-framework';

if (hasSubscribers('compile:error')) {
  mochiEvents.emit('compile:error', expensivePayload());
}
```

### `requestId` correlation

Every HTTP request carries a stable `requestId` on `request`, `error`, `action:invoke`, and `action:complete`. Use it to stitch a 500 trace together. The same id is on the request context.

To honour an upstream id from a trusted reverse proxy, set `proxy.requestIdHeader` on `Mochi.serve()`.

<Callout type="danger">

**Only set `proxy.requestIdHeader` for traffic you fully control.** Clients can spoof headers. If you trust untrusted traffic, attacker-controlled ids correlate unrelated requests together in logs.

</Callout>

### Event reference

Each event ships a typed payload matching `MochiEventMap` in `events.ts`.

#### `request`

Fires once per HTTP response, including CSRF rejects. Covers `Mochi.page` and `Mochi.api` routes.

| Field       | Type                   | Notes                                                      |
| ----------- | ---------------------- | ---------------------------------------------------------- |
| `requestId` | `string`               | correlation id                                             |
| `kind`      | `'page' \| 'api'`      | which route type handled it                                |
| `method`    | `string`               | HTTP method                                                |
| `path`      | `string`               | URL pathname                                               |
| `status`    | `number`               | response status code                                       |
| `duration`  | `number`               | wall-clock ms, end to end                                  |
| `warmup`    | `boolean \| undefined` | `true` when issued by [route warmup](/docs/serve-options/) |

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

Fires when an SSE stream starts.

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

Fires when the SSE stream closes. A client disconnect or an explicit close both count.

| Field      | Type     | Notes                  |
| ---------- | -------- | ---------------------- |
| `path`     | `string` | URL pathname           |
| `duration` | `number` | ms the stream was open |

#### `queue:added`

<VersionNote since="0.10.0" message="The bulk field is new in 0.10.0." />

Fires after `queue.add()` / `queue.addBulk()` enqueues a job. See [Queues](/docs/queues/).

| Field   | Type                   | Notes                                   |
| ------- | ---------------------- | --------------------------------------- |
| `queue` | `string`               | queue name                              |
| `jobId` | `string`               | generated job id                        |
| `bulk`  | `boolean \| undefined` | `true` when the add came from `addBulk` |

#### `queue:addedBulk`

<VersionNote since="0.10.0" message="queue:addedBulk is new in 0.10.0." />

Fires once per `addBulk()` call that inserted at least one job, alongside the per-job `queue:added` events. The [console logger](/docs/logging/) prints this summary instead of the per-job lines.

| Field    | Type       | Notes                                              |
| -------- | ---------- | -------------------------------------------------- |
| `queue`  | `string`   | queue name                                         |
| `count`  | `number`   | jobs actually inserted (duplicate ids are skipped) |
| `jobIds` | `string[]` | ids of the inserted jobs                           |

#### `queue:active`

Fires when a worker starts a job.

| Field     | Type     | Notes                                   |
| --------- | -------- | --------------------------------------- |
| `queue`   | `string` | queue name                              |
| `jobId`   | `string` | job id                                  |
| `attempt` | `number` | 1-based attempt number (1 on first run) |

#### `queue:completed`

Fires when a job's processor returns successfully.

| Field      | Type     | Notes                            |
| ---------- | -------- | -------------------------------- |
| `queue`    | `string` | queue name                       |
| `jobId`    | `string` | job id                           |
| `attempt`  | `number` | attempt that succeeded           |
| `duration` | `number` | ms the processor ran the attempt |

#### `queue:failed`

Fires when a job's processor throws. One emission per failed attempt.

| Field      | Type     | Notes                          |
| ---------- | -------- | ------------------------------ |
| `queue`    | `string` | queue name                     |
| `jobId`    | `string` | job id                         |
| `attempt`  | `number` | attempt that failed            |
| `duration` | `number` | processing ms before the throw |
| `error`    | `string` | thrown error message           |

#### `queue:error`

Fires for a queue-runtime error not tied to one job, for example a poll failure.

| Field   | Type      | Notes                                          |
| ------- | --------- | ---------------------------------------------- |
| `queue` | `string?` | absent for instance-level errors with no queue |
| `error` | `string`  | error message                                  |

#### `email:sent`

Fires after `Mochi.email()` hands a message to its transport. The [`email:message` filter](/docs/extensions/#emailmessage) can veto it first. See [Email](/docs/email/).

| Field       | Type                                                   | Notes                                                               |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `to`        | `string[]`                                             | recipient addresses, as actually sent                               |
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

<VersionNote since="0.10.0" message="The 'stop' reason is new in 0.10.0 — earlier versions emit this event only on signals." />

Fires when the server shuts down — on `SIGTERM` / `SIGINT`, or a programmatic [`Mochi.stop()`](/docs/queues/#mochistop) — after the `mochi:shutdown` hook runs.

| Field    | Type                                 | Notes                                          |
| -------- | ------------------------------------ | ---------------------------------------------- |
| `reason` | `'signal' \| 'stop'`                 | signal, or programmatic `Mochi.stop()`         |
| `signal` | `'SIGTERM' \| 'SIGINT' \| undefined` | the signal received; absent for `Mochi.stop()` |

#### `warmup:start`

Fires once when the [route warmup](/docs/serve-options/#route-warmup) batch begins. Only emitted with `warmup: true`.

| Field        | Type     | Notes                                 |
| ------------ | -------- | ------------------------------------- |
| `routeCount` | `number` | static page routes about to be warmed |

#### `warmup:complete`

Fires once after the [route warmup](/docs/serve-options/#route-warmup) batch finishes. Only emitted with `warmup: true`.

| Field        | Type     | Notes                                    |
| ------------ | -------- | ---------------------------------------- |
| `routeCount` | `number` | static page routes warmed                |
| `errorCount` | `number` | warmup invocations that threw or 5xx'd   |
| `durationMs` | `number` | wall-clock ms for the whole warmup batch |

#### `dictionary:ready`

Fires once when the boot harvest publishes the navigation dictionary. Only emitted with [`compressionDictionary`](/docs/compression-dictionaries/) enabled.

| Field        | Type     | Notes                                                    |
| ------------ | -------- | -------------------------------------------------------- |
| `hash`       | `string` | hex SHA-256 — also the `/_mochi/dictionary/:hash` URL id |
| `sizeBytes`  | `number` | dictionary size, after any over-cap route was skipped    |
| `routeCount` | `number` | page routes whose HTML made it into the dictionary       |
| `durationMs` | `number` | wall-clock ms from boot-render start to publish          |

#### `error`

Fires when a page, API, or form action handler throws and the framework returns an error response.

| Field        | Type                          | Notes                                  |
| ------------ | ----------------------------- | -------------------------------------- |
| `requestId`  | `string`                      | correlates with the matching `request` |
| `kind`       | `'page' \| 'api' \| 'action'` | which handler threw                    |
| `path`       | `string`                      | URL pathname + search                  |
| `method`     | `string`                      | HTTP method                            |
| `status`     | `number`                      | final response status                  |
| `message`    | `string`                      | error message                          |
| `stack`      | `string \| undefined`         | stack trace, dev only                  |
| `actionName` | `string \| undefined`         | present only when `kind=action`        |

```ts
mochiEvents.on('error', ({ kind, path, status, message, stack }) => {
  Sentry.captureException(new Error(message), { tags: { kind, path, status }, contexts: { stack } });
});
```

#### `action:invoke`

Fires immediately before a form action handler runs. Pairs with `action:complete` through `requestId`.

| Field        | Type     | Notes                                |
| ------------ | -------- | ------------------------------------ |
| `requestId`  | `string` | correlates with `action:complete`    |
| `path`       | `string` | URL pathname + search                |
| `actionName` | `string` | action name (`'default'` if unnamed) |

#### `action:complete`

Fires after a form action returns or throws. One emission per invocation, whatever the outcome.

| Field        | Type                                           | Notes                           |
| ------------ | ---------------------------------------------- | ------------------------------- |
| `requestId`  | `string`                                       | correlates with `action:invoke` |
| `path`       | `string`                                       | URL pathname + search           |
| `actionName` | `string`                                       | action name                     |
| `result`     | `'success' \| 'fail' \| 'redirect' \| 'error'` | outcome category                |
| `status`     | `number \| undefined`                          | set for `fail` and `redirect`   |

#### `compile:start`

Fires before each Svelte SSR compile. A cache hit skips it.

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

Fires when `Bun.build` rejects a Svelte source. The framework still throws after emitting. The event exists for tooling that wants the structured logs.

| Field     | Type                                                                        | Notes                            |
| --------- | --------------------------------------------------------------------------- | -------------------------------- |
| `path`    | `string`                                                                    | source that failed               |
| `message` | `string`                                                                    | top-line error message           |
| `logs`    | `Array<{ file?: string; line?: number; column?: number; message: string }>` | per-message diagnostics from Bun |

#### `recompile:start`

Fires from the dev watcher before a rebuild cycle begins. Production builds never emit. It wraps either a full SSR rebuild (`trigger: 'file' | 'svelte-config'`) or the CSS-only fast path (`trigger: 'css'`).

| Field       | Type                                 | Notes                                            |
| ----------- | ------------------------------------ | ------------------------------------------------ |
| `trigger`   | `'file' \| 'css' \| 'svelte-config'` | which watcher path fired                         |
| `path`      | `string`                             | file whose change triggered the rebuild          |
| `pageCount` | `number`                             | pages about to be rebuilt (`0` for the CSS path) |

#### `recompile:complete`

Fires after the matching `recompile:start`, once the rebuild finishes and clients are told to reload.

`clientBundleCount` counts `buildClientBundle()` calls inside the cycle. For a typical `'file'` trigger it must be `1`, or `0` when no hydratables are registered. A value above `1` means the registry's bundle deferral stopped working and you regressed to per-page bundling.

| Field               | Type                                 | Notes                                          |
| ------------------- | ------------------------------------ | ---------------------------------------------- |
| `trigger`           | `'file' \| 'css' \| 'svelte-config'` | matches `recompile:start`                      |
| `path`              | `string`                             | matches `recompile:start`                      |
| `pageCount`         | `number`                             | pages that were rebuilt                        |
| `clientBundleCount` | `number`                             | `buildClientBundle()` invocations during cycle |
| `durationMs`        | `number`                             | wall-clock ms for the whole cycle              |

#### `recompile:module-churn`

Fires once per dev session, when the entry has been re-imported `reloadCount` times (default 10). Each reload re-evaluates the whole first-party module graph, so a module-scoped resource is re-created and the old one orphaned — see [route-handler HMR](/docs/development-mode/#route-handler-hmr). `consoleLogger()` renders it as a `warn`-level `HMR` line; suppress that line with a [`consoleLogger:line`](/docs/extensions/#consoleloggerline) filter matching `source.name === 'recompile:module-churn'`.

| Field         | Type     | Notes                                       |
| ------------- | -------- | ------------------------------------------- |
| `reloadCount` | `number` | entry re-imports so far this session (≥ 10) |

```ts
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('recompile:module-churn', ({ reloadCount }) => {
  console.warn(`entry re-imported ${reloadCount}× — hold resources with pinGlobal()`);
});
```

#### `client-bundle:complete`

Fires whenever the registry rebuilds the hydratable client bundle. Production builds emit once at startup. Dev mode emits during `recompileAll()` and on lazy first-hit compiles for server islands.

| Field         | Type     | Notes                                                    |
| ------------- | -------- | -------------------------------------------------------- |
| `entryCount`  | `number` | entrypoints fed to Bun.build (bootstrap + per-component) |
| `outputBytes` | `number` | sum of all output sizes (JS + CSS) from the bundle       |
| `durationMs`  | `number` | wall-clock ms inside `buildClientBundle()`               |

#### `captcha:verify`

Fires when [`verifyCaptcha()`](/docs/captcha/) finishes. The client gets one generic message, but this event carries the real cause.

| Field    | Type                  | Notes                                                                     |
| -------- | --------------------- | ------------------------------------------------------------------------- |
| `ok`     | `boolean`             | whether verification passed                                               |
| `reason` | `MochiCaptchaReason`  | `'ok' \| 'malformed' \| 'expired' \| 'too-fast' \| 'bad-pow' \| 'replay'` |
| `bits`   | `number \| undefined` | difficulty sealed in the token                                            |
| `ageMs`  | `number \| undefined` | token age at verification                                                 |

#### `island:error`

Fires when an island fails: a server-island render, a hydratable SSR render, or client-side hydration. The framework still ships an error placeholder. See [Error boundaries](/docs/error-boundaries/#islanderror-event).

| Field           | Type                                           | Notes                                             |
| --------------- | ---------------------------------------------- | ------------------------------------------------- |
| `componentName` | `string`                                       | island component identifier                       |
| `islandId`      | `string \| undefined`                          | envelope id; set for `'server'`, else `undefined` |
| `kind`          | `'hydratable' \| 'server' \| 'client-hydrate'` | which lifecycle stage failed                      |
| `message`       | `string`                                       | error message                                     |
| `stack`         | `string \| undefined`                          | stack trace, dev only                             |

#### `file:change`

Fires from the dev file watcher (chokidar). Production builds do not run the watcher, so this event never emits there.

| Field  | Type                  | Notes                                                      |
| ------ | --------------------- | ---------------------------------------------------------- |
| `path` | `string`              | absolute path of the changed file                          |
| `type` | `MochiFileChangeType` | `'add' \| 'change' \| 'unlink' \| 'addDir' \| 'unlinkDir'` |

#### `image:store`

Fires when the [`<Image>`](/docs/images/) cache commits a file to disk: a downloaded full-size `original`, a resized `variant`, or a ThumbHash blur `placeholder`. Emitted once per regeneration, because concurrent misses coalesce. Use it to mirror cache writes to durable storage such as S3.

| Field         | Type                                       | Notes                                                   |
| ------------- | ------------------------------------------ | ------------------------------------------------------- |
| `kind`        | `'original' \| 'variant' \| 'placeholder'` | which entry type was written                            |
| `src`         | `string`                                   | the image source (URL/key) this entry derives from      |
| `path`        | `string`                                   | absolute path of the file just committed on disk        |
| `id`          | `string`                                   | `variantId` for `variant`; `originalId(src)` otherwise  |
| `size`        | `number`                                   | bytes written                                           |
| `contentType` | `string`                                   | authoritative content type; `''` for `placeholder`      |
| `width`       | `number`                                   | pixel width; `0` for `original` and `placeholder`       |
| `height`      | `number`                                   | pixel height; `0` for `original` and `placeholder`      |
| `format`      | `string`                                   | encoded format such as `'webp'`; `''` for the two above |

```ts
import { readFileSync } from 'node:fs';
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('image:store', ({ kind, src, path, contentType }) => {
  const body = readFileSync(path); // sync: the file is guaranteed present now
  void s3.putObject({ Bucket, Key: `img/${kind}/${src}`, Body: body, ContentType: contentType });
});
```

<Callout type="warning">

Read the file **synchronously at the top of the handler** — it provably exists at emit time — then offload the upload to a fire-and-forget task. A lazy `await readFile(path)` inside a slow handler could race the janitor sweep and miss the file.

</Callout>

#### `image:delete`

Fires when the `<Image>` cache removes a file from disk. The janitor sweep evicts it, a newer generation supersedes it, or you invalidate it explicitly. Pair it with `image:store` to keep an S3 mirror in sync. A bulk `invalidateSrc()` only emits per-file deletes while a subscriber is registered.

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

### Custom events

`mochiEvents` is a plain mitt emitter. `emit` your own keys on it for quick experiments. Custom keys are absent from `MochiEventMap`, so handlers and emit sites lose typing.

### Built-in subscribers

`consoleLogger()` already prints `request`, `ws:*`, `sse:*`, `server:*`, `error`, and `cache:revalidate` lines. Pass `{ cache: 'verbose' }` to also print every `cache:read`, or `{ cache: false }` to silence cache logging.

<SeeItInAction
demos={[{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents." }]}
/>
