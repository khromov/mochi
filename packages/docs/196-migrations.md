---
title: 'Migrations'
slug: migrations
description: 'Breaking changes by version, one line each, as a block you can copy straight into a coding assistant.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Migrations

One block per version: every breaking change, who it affects, and what to do about it.

<Callout type="info">

**Copy the block for your target version and hand it to your coding assistant**, along with a prompt like _"upgrade this app to Mochi 0.10.0, working through each item"_. The whole page is also served as plain text at [`/docs/migrations/llms.txt`](/docs/migrations/llms.txt).

</Callout>

### 0.10.0

<VersionNote since="0.10.0" message="This block lists what changes when you upgrade to it." />

```plaintext
# Mochi 0.10.0 — breaking changes

## Runtime

### Development mode

    "dev": "NODE_ENV=development bun src/index.ts"   ← package.json

- Mochi requires Bun 1.4 or newer. Upgrade Bun.
- `Mochi.serve()` without a `development` option now starts in production unless `NODE_ENV=development` is set; it used to default to development. Set `NODE_ENV=development` in your dev script, or pass `development: true`.
- An app that relied on the old default now runs in production wherever `NODE_ENV` is not `development`, including under `bun test`, which sets `NODE_ENV=test`. There, form POSTs get 403 until `proxy.origin` or `proxy.hostHeader` is set. Set `proxy.origin` before deploying, and pass `development: true` in tests that rely on development behaviour.
- A prebuilt manifest from an earlier release is rejected. Re-run the build before deploying.
- Mochi refuses to start when `MOCHI_KEY` decodes to no bytes or only zero bytes (`MOCHI_KEY=""` passed through `docker --env-file`, a placeholder like `x`), or when a `serverIsland:secretKey` filter returns such a Buffer. Generate a key with `bunx mochi-framework generate-key`.

## Errors

- In production, a page render that hits compile errors answers a generic `500 Internal Server Error` instead of the compile report, and `handleError` receives a plain `Error` instead of a `MochiHttpError`. Read the report from `error.message` in `handleError` or from the server log; development is unchanged.
- In production, an enhanced form action that throws a plain `Error` now sends the client `Internal Server Error` instead of the error's message. Return `fail()` or throw `error(status, message)` for a message the client should see.

## Middleware and server islands

- `handle` now runs on server-island fetches (`/_mochi/island/<key>`) with `event.kind === 'island'`, and a `transformPage` passed to `resolve()` now also receives each island's HTML fragment. Add an `'island'` case to any exhaustive switch over `event.kind`, check that path-based auth rules still let the islands on public pages through, and make `transformPage` handle a fragment without `<head>` or `<body>`.
- A server-island fetch without its sealed `?props=` token now gets 403 instead of rendering with empty props. Request islands only through the URLs Mochi renders into the page.

## Forms

- An action name that `actions` only inherits through its prototype (`Object.create(base)`, class methods) now answers 404 `Unknown form action`. Make every action an own property: spread a plain base object (`actions: { ...base }`), and list class methods explicitly (`actions: { save: (event) => form.save(event) }`), because a spread skips them.
- `enhance()` no longer follows a `redirect()` to a `javascript:`, `data:` or `vbscript:` URL; it logs the location and stays on the page. Redirect to a page URL instead.

## Cookies

### Deleting a cookie set with per-call options

    'cookie:defaults': () => ({ secure: true })     ← filters in Mochi.serve()
    cookies.set('theme', 'dark', { secure: false });
    cookies.delete('theme');                     ← sends Secure, ignored over plain HTTP
    cookies.delete('theme', { secure: false });  ← repeat the set() options

- `cookies.delete()` now sends every `cookie:defaults` attribute (`Secure`, `Partitioned`, `HttpOnly`, `SameSite`, `Priority`), not only `path` and `domain`. Where `cookies.set()` overrode a default per call, pass the same options to `cookies.delete()`, or the browser can ignore the deletion.
- In the browser, `cookies.set()` and `cookies.delete()` now apply `cookie:defaults` too (all but `httpOnly`, `maxAge` and `expires`) instead of only the per-call options. With a `path` default other than `/`, client cookies move off `Path=/`, and with `secure: true` a client write is dropped over plain HTTP. Pass per-call options where client code needs other attributes.

## Email

### Attachments

    attachments: [{ filename: 'invoice.pdf', path: './invoice.pdf' }]                           ← now rejected
    attachments: [{ filename: 'invoice.pdf', content: await Bun.file('./invoice.pdf').bytes() }]

- An authenticated SMTP send on a non-`secure` connection now fails when the server does not offer STARTTLS, instead of sending the credentials in plaintext. Set `requireTLS: false` only for a trusted relay without TLS.
- The SMTP transport no longer reads files or fetches URLs named in a message (`path` or `href` on attachments, `html`, `text`, `alternatives`), so such a send rejects. Pass the bytes as `content`.
- `@font-face` rules are stripped from emails rendered from a Svelte `component`, with a warning; `html` strings are untouched. Use web-safe fonts in email templates.

## Rate limiting

- The store factories were renamed: `memoryStore`, `sqliteStore` and `postgresStore` are now `rateLimitMemoryStore`, `rateLimitSqliteStore` and `rateLimitPostgresStore`, and `MochiSqliteStoreOptions`/`MochiPostgresStoreOptions` are now `MochiRateLimitSqliteStoreOptions`/`MochiRateLimitPostgresStoreOptions`. Update the imports.

## Queues

### New queue API

    const emails = Mochi.queue('emails', { process: sendEmail });
    await Mochi.serve({ queues: [emails], routes });
    await emails.add({ to }, { startAfter: 30, retryLimit: 3 });

- `Mochi.queue()` takes the queue name as its first argument, and `queues` is an array of descriptors rather than an object. Update the call sites.
- Queue names may contain only letters, digits, `_`, `.`, `-` and `/`, and may not start with `cron-`; Mochi throws otherwise. Rename the queue, for example `emails:send` to `emails.send`.
- Jobs no longer have a name: `queue.add()` takes `(data, opts)` and resolves to a job id, or `null` for a duplicate `id`; `addBulk()` takes `{ data, opts }` items and resolves to an array of ids; `job.name` is gone. Drop the name argument; an untyped `add(name, data)` call still resolves, but its job never runs.
- Job options were renamed: `delay` in milliseconds is now `startAfter` in seconds, `attempts: n` (total runs) is `retryLimit: n - 1` (retries after the first run), and `jobId` is `id`. Update the call sites.
- The `dataPath`, `lockDuration`, `recover`, `defaultJobOptions` and `bunqueue` options are gone (`bunqueue` from job options too). Use `queueStorage: { sqlite: path }` to persist jobs, `expireInSeconds` for long-running jobs, queue-level `retryLimit`/`retryDelay` for job defaults, and `Mochi.boss()` for anything else.
- A failed job still runs up to 3 times by default, but it retries on the next poll instead of after an exponential backoff from 1 second. Set `retryDelay` (in seconds) and `retryBackoff: true` on the queue to space retries out.
- An active job expires after 15 minutes instead of 30. Raise `expireInSeconds` for a longer-running processor.
- On shutdown, a running job gets `queueShutdownTimeout` (10 seconds by default) to finish, then fails and is retried; it used to be waited for. Raise `queueShutdownTimeout` above your longest job.
- Jobs persisted through `dataPath` are not read by the new backend, even with `queueStorage` pointing at the same file. Drain the queue before upgrading.
- A queue whose declared config differs from the stored one throws at boot. Set `queueConfig: 'sync'` to adopt the declared config.
- `MochiJobRef`, `DEFAULT_LOCK_DURATION_MS` and `DEFAULT_RECOVERY_STALL_WARNING_MS` are no longer exported, the `queue:lockDurationMs` filter is now `queue:expireInSeconds` (in seconds), and `queue:recoveryStallWarningMs` is gone with `recover`. Use the id `add()` returns, and `DEFAULT_EXPIRE_IN_SECONDS`.
- The `queue:*` events no longer carry `jobName`, `queue:error` now fires only for runtime-level errors and has no `queue`, and the per-queue `on.error` listener is gone. Key on `queue` and `jobId`, and subscribe to `queue:error` on `mochiEvents` instead of `on.error`.

## Routing

- `trailingSlash` applies to page routes only: `Mochi.api()`, `Mochi.sse()`, `Mochi.ws()` and file routes now answer only on the exact path you registered, and the other slash form 404s instead of redirecting or being served. Call these routes by their registered path, or register both forms (`'/api/ping'` and `'/api/ping/'`).
- Unmatched paths are no longer slash-normalized, so they 404 instead of redirecting, and the `trailingSlash:redirect` filter now runs only for page routes. Handle it in your `fetch` fallback if you relied on that redirect.
- `redirect()` returned from `serverProps` now issues a real 3xx instead of being spread into props. Review any `serverProps` that returned one.
- `fail()` or `success()` returned from `serverProps` now throws. Return props or a redirect instead.

## Islands

### Island children

    <Counter mochi:hydrate>Total:</Counter>   ← build error
    <Counter mochi:hydrate label="Total:" />  ← pass it as a prop instead

- Children on a `mochi:hydrate` island are now a build error, because the island hydrates from its serialized props alone. Move the markup inside the component or pass it as serializable props; under `mochi:defer` and `mochi:clientOnly`, children are the loading fallback.
- A `*.server.svelte` component is now server-only: it cannot take `mochi:hydrate*` or `mochi:clientOnly*`, and inside a hydrated island the client bundle gets a stub that throws, so hydration fails (the build warns). Rename the file if the suffix was incidental.
- `mochi:defer` inside a `mochi:hydrate` subtree is now a build error. Restructure so the server island sits outside the hydrated subtree.
- Nested `mochi:defer` islands resolve in a single request, so child islands no longer have their own wrapper, caching or timing. Pass `inlineNestedIslands: false` to `Mochi.serve()` to keep a request per island.

## Assets and build output

- `mochi-framework build` refuses to empty an out-dir that contains the project, `--public-dir` or a page component, and a non-empty out-dir outside the project that holds no earlier Mochi build. Point `--out-dir` at a dedicated directory such as `./.mochi`.
- `compress()` dropped brotli and the `brotliQuality` option, and its default `methods` is now `['zstd', 'gzip']`: a client that prefers `br` gets gzip, and one that lists `zstd` before `gzip` gets `Content-Encoding: zstd`. Remove `'brotli'` and `brotliQuality`, and set `methods: ['gzip']` if an intermediary cannot handle zstd.
- Fonts imported through CSS are served as separate assets from `/_mochi/fonts/` rather than inline base64, and are preloaded. Allow `'self'` in a CSP `font-src` that only allowed `data:`, or raise `fonts.inlineThreshold`.
- Imported CSS bundles are minified, so their content hashes change. No action needed unless those URLs were pinned somewhere.
- A module named `*.prerender.ts` or `*.prerender.js` now runs at build time and ships only its serialized exports, so one that exports a function fails the build. Rename the file if the suffix was incidental.

## Other

- Memory-pressure cache eviction is on in production and clears in-memory caches when the OS reports critical pressure. Set `memoryPressure: false` to keep the old behaviour.
- `svelte-shaker` moved out of `mochi-framework` into the optional add-on `@mochi-framework/svelte-shaker`, so `optimize` builds unshaken, with a warning, until it is installed. Install `@mochi-framework/svelte-shaker`.
- `DEV` is no longer declared on `mochi-framework`, so importing it fails type-checking. Use `isDev`.
- `runTests()` runs at most 6 test files in parallel. Set `MOCHI_MAX_CONCURRENCY=max` to restore the old fan-out.
- `MochiServerStopEvent.reason` gained `'stop'`, and the `signal` on `mochi:shutdown` is now optional. Widen any exhaustive switch or non-optional read.
- `mochi-framework update-skill` shows a diff and asks before overwriting a changed `SKILL.md`, and exits 1 when there is no terminal to ask at. Pass `--force` in scripts and CI.
- `create-mochi` adds ESLint and Prettier to new projects by default. Pass `--no-eslint --no-prettier` to skip them.
```
