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

<VersionNote since="0.10.0" message="0.10.0 is not released yet. This block lists what changes when you upgrade to it." />

```plaintext
# Mochi 0.10.0 — breaking changes

## Runtime

### Development mode

    "dev": "NODE_ENV=development bun src/index.ts"   ← package.json

- Mochi requires Bun 1.4 or newer. Upgrade Bun.
- `Mochi.serve()` without a `development` option now starts in production unless `NODE_ENV=development` is set; it used to default to development. Set `NODE_ENV=development` in your dev script, or pass `development: true`.
- A prebuilt manifest from an earlier release is rejected. Re-run the build before deploying.
- Mochi refuses to start when `MOCHI_KEY` decodes to no bytes or only zero bytes (`MOCHI_KEY=""` passed through `docker --env-file`, a placeholder like `x`), or when a `serverIsland:secretKey` filter returns such a Buffer. Generate a key with `bunx mochi-framework generate-key`.

## Errors

- In production, a page render that hits compile errors answers a generic `500 Internal Server Error` instead of the compile report, and `handleError` receives a plain `Error` instead of a `MochiHttpError`. Read the report from `error.message` in `handleError` or from the server log; development is unchanged.
- In production, an enhanced form action that throws a plain `Error` now sends the client `Internal Server Error` instead of the error's message. Return `fail()` or throw `error(status, message)` for a message the client should see.

## Middleware and server islands

- `handle` now runs on server-island fetches (`/_mochi/island/<key>`) with `event.kind === 'island'`. Add an `'island'` case to any exhaustive switch over `event.kind`, and check that path-based auth rules still let the islands on public pages through.
- A server-island fetch without its sealed `?props=` token now gets 403 instead of rendering with empty props. Request islands only through the URLs Mochi renders into the page.

## Forms

- An action name that `actions` only inherits through its prototype (`Object.create(base)`, class methods) now answers 404 `Unknown form action`. Make every action an own property, for example `actions: { ...base }`.
- `enhance()` no longer follows a `redirect()` to a `javascript:`, `data:` or `vbscript:` URL; it logs the location and stays on the page. Redirect to a page URL instead.

## Cookies

### Deleting a cookie set with per-call options

    cookies.set('theme', 'dark', { secure: false });
    cookies.delete('theme');                     ← no longer clears it
    cookies.delete('theme', { secure: false });  ← repeat the set() options

- `cookies.delete()` now sends every `cookie:defaults` attribute (`Secure`, `Partitioned`, `HttpOnly`, `SameSite`), not only `path` and `domain`. Where `cookies.set()` overrode a default per call, pass the same options to `cookies.delete()`, or the browser can ignore the deletion.

## Email

### Attachments

    attachments: [{ filename: 'invoice.pdf', path: './invoice.pdf' }]                           ← now rejected
    attachments: [{ filename: 'invoice.pdf', content: await Bun.file('./invoice.pdf').bytes() }]

- An authenticated SMTP send on a non-`secure` connection now fails when the server does not offer STARTTLS, instead of sending the credentials in plaintext. Set `requireTLS: false` only for a trusted relay without TLS.
- The SMTP transport no longer reads files or fetches URLs named in a message (`path` or `href` on attachments, `html`, `text`, `alternatives`), so such a send rejects. Pass the bytes as `content`.
- `@font-face` rules are stripped from rendered emails. Use web-safe fonts in email templates.

## Rate limiting

- The store factories were renamed: `memoryStore`, `sqliteStore` and `postgresStore` are now `rateLimitMemoryStore`, `rateLimitSqliteStore` and `rateLimitPostgresStore`, and `MochiSqliteStoreOptions`/`MochiPostgresStoreOptions` are now `MochiRateLimitSqliteStoreOptions`/`MochiRateLimitPostgresStoreOptions`. Update the imports.

## Queues

### New queue API

    const emails = Mochi.queue('emails', { process: sendEmail });
    await Mochi.serve({ queues: [emails], routes });
    await emails.add({ to }, { startAfter: 30, retryLimit: 3 });

- `Mochi.queue()` takes the queue name as its first argument, and `queues` is an array of descriptors rather than an object. Update the call sites.
- `queue.add()` takes `(data, opts)` and resolves to a job id or `null`. Update the call sites.
- Job options were renamed: `delay` in milliseconds is now `startAfter` in seconds, `attempts` is `retryLimit`, and `jobId` is `id`. Update the call sites.
- The `dataPath`, `lockDuration`, `recover`, `defaultJobOptions` and `bunqueue` queue options are gone. Use `queueStorage: { sqlite: path }` to persist jobs, `expireInSeconds` for long-running jobs, queue-level `retryLimit`/`retryDelay` for job defaults, and `Mochi.boss()` for anything else.
- Jobs now retry twice by default where they previously ran once. Set `retryLimit: 0` if a job must never run twice.
- An active job expires after 15 minutes instead of 30. Raise `expireInSeconds` for a longer-running processor.
- Queue storage uses a new schema, so jobs pending in an existing store are not carried over. Drain the queue before upgrading.
- A queue whose declared config differs from the stored one throws at boot. Set `queueConfig: 'sync'` to adopt the declared config.
- `MochiJobRef`, `DEFAULT_LOCK_DURATION_MS` and `DEFAULT_RECOVERY_STALL_WARNING_MS` are no longer exported, and the `queue:lockDurationMs` and `queue:recoveryStallWarningMs` filters are gone. Drop them; `queue:expireInSeconds` replaces the filters.
- The `queue:*` events no longer carry `jobName`, and `queue:error` may omit `queue`. Read the queue name from the event, and handle an error with no queue.

## Routing

- `trailingSlash` applies to page routes only: API and SSE routes are no longer mirrored or redirected, and WebSocket and file routes no longer answer on both slash forms. Register both forms for any route clients reach by the non-canonical path.
- Unmatched paths are no longer slash-normalized, so they 404 instead of redirecting. Handle it in your `fetch` fallback if you relied on that redirect.
- `redirect()` returned from `serverProps` now issues a real 3xx instead of being spread into props. Review any `serverProps` that returned one.
- `fail()` or `success()` returned from `serverProps` now throws. Return props or a redirect instead.

## Islands

### Island children

    <Counter mochi:hydrate>Total:</Counter>   ← build error
    <Counter mochi:hydrate label="Total:" />  ← pass it as a prop instead

- Children on a `mochi:hydrate` island are now a build error, because the island hydrates from its serialized props alone. Move the markup inside the component or pass it as serializable props; under `mochi:defer` and `mochi:clientOnly`, children are the loading fallback.
- A `.server.svelte` component cannot take `mochi:hydrate*` or `mochi:clientOnly*`. Rename the file if the suffix was incidental.
- `mochi:defer` inside a `mochi:hydrate` subtree is now a build error. Restructure so the server island sits outside the hydrated subtree.
- Nested `mochi:defer` islands resolve in a single request, so child islands no longer have their own wrapper, caching or timing. Set `inlineNestedIslands: false` to keep a request per island.

## Assets and build output

- `mochi-framework build` refuses to empty an out-dir that contains the project, `--public-dir` or a page component, and a non-empty out-dir outside the project that holds no earlier Mochi build. Point `--out-dir` at a dedicated directory such as `./.mochi`.
- `compress()` dropped brotli and the `brotliQuality` option, and defaults to zstd, so responses go out with `Content-Encoding: zstd`. Remove `'brotli'` from `methods`, and set `methods: ['gzip']` if an intermediary cannot handle zstd.
- Fonts imported through CSS are served as separate assets from `/_mochi/fonts/` rather than inline base64, and are preloaded. Allow `'self'` in a CSP `font-src` that only allowed `data:`, or raise `fonts.inlineThreshold`.
- Imported CSS bundles are minified, so their content hashes change. No action needed unless those URLs were pinned somewhere.

## Other

- Memory-pressure cache eviction is on in production and clears in-memory caches when the OS reports critical pressure. Set `memoryPressure: false` to keep the old behaviour.
- `svelte-shaker` is now an optional peer dependency, so `optimize` builds unshaken without it. Install `@mochi-framework/svelte-shaker`.
- `runTests()` runs at most 6 test files in parallel. Set `MOCHI_MAX_CONCURRENCY=max` to restore the old fan-out.
- `MochiServerStopEvent.reason` gained `'stop'`, and the `signal` on `mochi:shutdown` is now optional. Widen any exhaustive switch or non-optional read.
- `mochi-framework update-skill` shows a diff and asks before overwriting a changed `SKILL.md`, and exits 1 when there is no terminal to ask at. Pass `--force` in scripts and CI.
- `create-mochi` adds ESLint and Prettier to new projects by default. Pass `--no-eslint --no-prettier` to skip them.
```
