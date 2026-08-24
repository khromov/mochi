---
title: 'Migrations'
slug: migrations
description: 'Breaking changes by version, one line each, as a block you can copy straight into a coding assistant.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Migrations

One block per version: every breaking change, and what to do about it.

<Callout type="info">

**Copy the block for your target version and hand it to your coding assistant**, along with a prompt like _"upgrade this app to Mochi 0.10.0, working through each item"_. The whole page is also served as plain text at [`/docs/migrations/llms.txt`](/docs/migrations/llms.txt).

</Callout>

## 0.10.0

```plaintext
# Mochi 0.10.0 — breaking changes

## Runtime

- Mochi requires Bun 1.4 or newer. Upgrade Bun.
- A prebuilt manifest from an earlier release is rejected. Re-run the build before deploying.

## Cookies, redirects and headers

- Cookies set through the server jar are now `HttpOnly`, `SameSite=Lax`, and `Secure` outside development. Pass `{ httpOnly: false }` per cookie where client JS reads or writes it, or set `secureCookies: false` to keep the old defaults.
- `HttpOnly` also stops the browser overwriting or deleting a cookie, so client-side writes to a server-set name are silently ignored. Pass `{ httpOnly: false }` where the server sets it.
- Cross-origin WebSocket upgrades are rejected in production. Add the origins to `csrf.trustedOrigins`, or set `csrf.checkOrigin: false`, which also disables the form CSRF check.
- `redirect()` to another origin fails with 500 in production. Add the origin to `redirect.trustedOrigins`, or pass `{ external: true }` on an individual call.
- `redirect()` rejects any location containing control characters, including tab and DEL. Encode the value before passing it.
- `redirect()` rejects `javascript:`, `data:`, `blob:`, `file:` and other script-capable schemes outright. Nothing waives these; send the visitor to a real destination.
- With no `proxy.origin` or `proxy.hostHeader` set, production blocks every absolute redirect location. Configure `proxy.origin`.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy` are now sent on every response. Set `securityHeaders: false`, or override an individual header, to keep the old behaviour.

## Queues

    const emails = Mochi.queue('emails', { process: sendEmail });
    await Mochi.serve({ queues: [emails], routes });
    await emails.add({ to }, { startAfter: 30, retryLimit: 3 });

- `Mochi.queue()` takes the queue name as its first argument, and `queues` is an array of descriptors rather than an object. Update the call sites.
- `queue.add()` takes `(data, opts)` and resolves to a job id or `null`. Update the call sites.
- Job options were renamed: `delay` in milliseconds is now `startAfter` in seconds, `attempts` is `retryLimit`, and `jobId` is `id`. Update the call sites.
- Jobs now retry twice by default where they previously ran once. Set `retryLimit: 0` if a job must never run twice.
- An active job expires after 15 minutes instead of 30. Raise `expireInSeconds` for a longer-running processor.
- Queue storage uses a new schema, so jobs pending in an existing store are not carried over. Drain the queue before upgrading.
- A queue whose declared config differs from the stored one throws at boot. Set `queueConfig: 'sync'` to adopt the declared config.
- `MochiJobRef`, `DEFAULT_LOCK_DURATION_MS` and `DEFAULT_RECOVERY_STALL_WARNING_MS` are no longer exported, and the `queue:lockDurationMs` and `queue:recoveryStallWarningMs` filters are gone. Drop them; `queue:expireInSeconds` replaces the filters.
- The `queue:*` events no longer carry `jobName`. Read the queue name from the event.

## Routing

- `trailingSlash` applies to page routes only, so API, SSE, WebSocket and file routes no longer redirect the alternate slash form. Register both forms for any route clients reach by the non-canonical path.
- Unmatched paths are no longer slash-normalized, so they 404 instead of redirecting. Handle it in your `fetch` fallback if you relied on that redirect.
- `redirect()` returned from `serverProps` now issues a real 3xx instead of being spread into props. Review any `serverProps` that returned one.
- `fail()` or `success()` returned from `serverProps` now throws. Return props or a redirect instead.
- The redirect marker was renamed from `__mochiFormRedirect` to `__mochiRedirect`, and `MochiFormRedirect` to `MochiRedirect`. Update anything that inspects action results structurally.

## Islands

- Children on a `mochi:hydrate` island are now a build error. Move the content inside the island, or use `mochi:defer`.
- A `.server.svelte` component cannot be hydrated. Rename the file if the suffix was incidental.
- `mochi:defer` inside a `mochi:hydrate` subtree is now a build error. Restructure so the server island sits outside the hydrated subtree.
- Nested `mochi:defer` islands resolve in a single request, so child islands no longer have their own wrapper, caching or timing. Set `inlineNestedIslands: false` to keep a request per island.

## Assets and build output

- `compress()` dropped brotli and defaults to zstd, so responses go out with `Content-Encoding: zstd`. Set `methods: ['gzip']` if an intermediary cannot handle zstd.
- Fonts imported through CSS are served as separate assets rather than inline base64, and are preloaded. Widen a CSP `font-src` that only allowed `data:`, or adjust the `fonts` option.
- Imported CSS bundles are minified, so their content hashes change. No action needed unless those URLs were pinned somewhere.
- `@font-face` rules are stripped from rendered emails. Use web-safe fonts in email templates.

## Other

- Memory-pressure cache eviction is on in production and clears in-memory caches when the OS reports critical pressure. Set `memoryPressure: false` to keep the old behaviour.
- `svelte-shaker` is now an optional peer dependency, so `optimize` builds unshaken without it. Install `@mochi-framework/svelte-shaker`.
- `runTests()` runs at most 6 test files in parallel. Set `MOCHI_MAX_CONCURRENCY=max` to restore the old fan-out.
- `MochiServerStopEvent.reason` gained `'stop'`, and the `signal` on `mochi:shutdown` is now optional. Widen any exhaustive switch or non-optional read.
- `create-mochi` adds ESLint and Prettier to new projects by default. Pass `--no-eslint --no-prettier` to skip them.
```
