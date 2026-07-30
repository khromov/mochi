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

### Event index

- [`request`](#request) — every HTTP request (page or API)
- `ws:open`, `ws:message`, `ws:close` — WebSocket lifecycle
- `sse:open`, `sse:message`, `sse:close` — Server-Sent Events lifecycle
- `queue:added`, `queue:active`, `queue:completed`, `queue:failed`, `queue:error` — [background job](/docs/queues/) lifecycle
- `email:sent`, `email:error` — [transactional email](/docs/email/) delivery
- `server:start`, `server:stop` — server lifecycle
- `warmup:start`, `warmup:complete` — route warmup batch (only with `warmup: true`)
- [`error`](#error) — a page/api/action handler threw
- `action:invoke`, `action:complete` — form action lifecycle
- `compile:start`, `compile:complete`, `compile:error` — Svelte SSR build
- `recompile:start`, `recompile:complete` — dev rebuild cycle
- `client-bundle:complete` — hydratable client bundle finished
- [`island:error`](/docs/error-boundaries/#islanderror-event) — an island errored
- `captcha:verify` — a `<MochiCaptcha>` submission was verified or rejected
- `file:change` — dev-only file watcher
- `image:store`, `image:delete`, `image:cache-sweep` — [`<Image>`](/docs/images/) cache activity
- `cache:read`, `cache:revalidate` — see [Cache events](/docs/cache/#subscribing-to-cache-events)

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

| Field       | Type                   | Notes                                                       |
| ----------- | ---------------------- | ----------------------------------------------------------- |
| `requestId` | `string`               | correlation id                                              |
| `kind`      | `'page' \| 'api'`      | which route type handled it                                 |
| `method`    | `string`               | HTTP method                                                 |
| `path`      | `string`               | URL pathname                                                |
| `status`    | `number`               | response status code                                        |
| `duration`  | `number`               | wall-clock ms, end to end                                   |
| `warmup`    | `boolean \| undefined` | `true` when issued by [route warmup](/docs/serve-options/)  |

#### WebSocket events

`ws:open` (`path`, `duration`), `ws:message` (`path`, `size`, `type`), `ws:close` (`path`, `duration`, `code`, `reason`).

#### SSE events

`sse:open` (`path`), `sse:message` (`path`, `size`, `event?`), `sse:close` (`path`, `duration`).

#### Queue events

`queue:added` (`queue`, `jobId`, `jobName`), `queue:active` (`+ attempt`), `queue:completed` (`+ attempt, duration`), `queue:failed` (`+ attempt, duration, error`), `queue:error` (`queue`, `error`). See [Queues](/docs/queues/).

#### Email events

`email:sent` (`to`, `subject`, `transport`, `messageId?`, `duration`), `email:error` (`to`, `cc?`, `bcc?`, `subject`, `transport`, `error`). `transport` may be `'smtp' | 'custom' | 'log' | 'dev' | 'suppressed'`. See [Email](/docs/email/).

#### `server:start` / `server:stop`

`server:start` (`port?`, `hostname?`, `development`, `routes: { page, api, ws, sse }`). `server:stop` (`reason: 'signal'`, `signal?`).

#### Warmup events

`warmup:start` (`routeCount`), `warmup:complete` (`routeCount`, `errorCount`, `durationMs`). Only with `warmup: true`.

#### `error`

Fires when a page, API, or form action handler throws and the framework returns an error response.

| Field        | Type                          | Notes                                   |
| ------------ | ----------------------------- | --------------------------------------- |
| `requestId`  | `string`                      | correlates with the matching `request`  |
| `kind`       | `'page' \| 'api' \| 'action'` | which handler threw                     |
| `path`       | `string`                      | URL pathname + search                   |
| `method`     | `string`                      | HTTP method                             |
| `status`     | `number`                      | final response status                   |
| `message`    | `string`                      | error message                           |
| `stack`      | `string \| undefined`         | stack trace, dev only                   |
| `actionName` | `string \| undefined`         | present only when `kind=action`         |

```ts
mochiEvents.on('error', ({ kind, path, status, message, stack }) => {
  Sentry.captureException(new Error(message), { tags: { kind, path, status }, contexts: { stack } });
});
```

#### Action events

`action:invoke` (`requestId`, `path`, `actionName`), `action:complete` (`+ result: 'success' | 'fail' | 'redirect' | 'error'`, `status?`).

#### Compile events

`compile:start` (`path`), `compile:complete` (`path`, `ssrSizeBytes`, `hydratableCount`, `serverIslandCount`, `durationMs`), `compile:error` (`path`, `message`, `logs`).

#### Dev rebuild events

`recompile:start` (`trigger: 'file' | 'css' | 'svelte-config'`, `path`, `pageCount`), `recompile:complete` (`+ clientBundleCount`, `durationMs`). Production builds never emit. A healthy `clientBundleCount` for a non-CSS save is `1`; a higher number means a regression to per-page bundling.

#### `client-bundle:complete`

`entryCount`, `outputBytes`, `durationMs`. Fires whenever the registry rebuilds the hydratable client bundle.

#### `captcha:verify`

Fires when [`verifyCaptcha()`](/docs/captcha/) finishes. The client gets one generic message, but this event carries the real cause.

| Field    | Type                  | Notes                                                                     |
| -------- | --------------------- | ------------------------------------------------------------------------- |
| `ok`     | `boolean`             | whether verification passed                                               |
| `reason` | `MochiCaptchaReason`  | `'ok' \| 'malformed' \| 'expired' \| 'too-fast' \| 'bad-pow' \| 'replay'` |
| `bits`   | `number \| undefined` | difficulty sealed in the token                                            |
| `ageMs`  | `number \| undefined` | token age at verification                                                 |

#### `island:error`

`componentName`, `islandId?`, `kind: 'hydratable' | 'server' | 'client-hydrate'`, `message`, `stack?`. See [Error boundaries](/docs/error-boundaries/#islanderror-event).

#### `file:change`

`path` (absolute), `type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'`. Dev-only.

#### Image events

`image:store` and `image:delete` fire when the [`<Image>`](/docs/images/) cache writes or removes a file. Pair them to keep an S3 mirror in sync.

```ts
import { readFileSync } from 'node:fs';
import { mochiEvents } from 'mochi-framework';

mochiEvents.on('image:store', ({ kind, src, path, contentType }) => {
  const body = readFileSync(path); // sync: the file is guaranteed present now
  void s3.putObject({ Bucket, Key: `img/${kind}/${src}`, Body: body, ContentType: contentType });
});
```

`image:store` fields: `kind: 'original' | 'variant' | 'placeholder'`, `src`, `path`, `id`, `size`, `contentType`, `width`, `height`, `format`. `image:delete` adds `reason: 'evicted' | 'superseded' | 'invalidated'`.

<Callout type="warning">

Read the file **synchronously at the top of the handler** — it provably exists at emit time — then offload the upload to a fire-and-forget task. A lazy `await readFile(path)` inside a slow handler could race the janitor sweep and miss the file.

</Callout>

### Custom events

`mochiEvents` is a plain mitt emitter. `emit` your own keys on it for quick experiments. Custom keys are absent from `MochiEventMap`, so handlers and emit sites lose typing.

### Built-in subscribers

`consoleLogger()` already prints `request`, `ws:*`, `sse:*`, `server:*`, `error`, and `cache:revalidate` lines. Pass `{ cache: 'verbose' }` to also print every `cache:read`, or `{ cache: false }` to silence cache logging.

<SeeItInAction
demos={[{ href: "/demos/cache-events/", title: "Cache Events", hook: "Subscribe to MochiCache lifecycle events through mochiEvents." }]}
/>
