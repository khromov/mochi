---
title: 'Migrations'
slug: migrations
description: 'Breaking changes by version, the symptom each one produces, and the exact edit that fixes or reverts it.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Migrations

Each entry names the **symptom**, the **fix** that keeps the new behaviour, and the **revert** that restores the old one. Prefer the fix; the revert is there so an upgrade is never blocked on a refactor.

<Callout type="info">

**Hand this page to your coding assistant.** It is written to be actionable without the rest of the docs: every entry carries the log line or status code to search for, a `grep` for the affected call sites, and the exact option to set. Give the agent [`/docs/migrations/llms.txt`](/docs/migrations/llms.txt) — or use the `llms.txt` copy button on this page — with a prompt like:

> Upgrade this app to Mochi 0.10.0. Work through each breaking change in the attached migration guide: find the affected code, apply the **fix** (not the revert) where the app's behaviour allows it, and list anything you had to revert instead and why.

</Callout>

## 0.10.0

Requires **Bun 1.4 or newer** and a **rebuild**. Both fail loudly at boot, so start there:

```sh
bun --version               # must be >= 1.4.0
bun run build               # manifest v2 from an older release is rejected
```

- `Mochi requires Bun 1.4.0 or higher (found 1.3.14).` — the version gate runs before the socket binds, in `Mochi.serve()` and in `mochi-framework build`. No opt-out.
- `[mochi] Manifest at .mochi/manifest.json is version 2, but this mochi-framework runtime reads version 3.` — a deploy that ships a prebuilt manifest must rebuild with the matching version.

### Cookies, redirects and headers

The security defaults. This block reverts all four at once:

```ts
await Mochi.serve({
  secureCookies: false, // cookies: no HttpOnly/SameSite/Secure baseline
  csrf: { checkOrigin: false }, // WebSocket upgrades: no origin check
  redirect: { trustedOrigins: ['https://example.com'] }, // redirects: list every off-origin target
  securityHeaders: false, // responses: no nosniff / Referrer-Policy
  routes,
});
```

<Callout type="warning">

`csrf.checkOrigin: false` is one switch for two checks — it disables the form-POST CSRF check as well as the WebSocket one. Use `csrf.trustedOrigins` instead unless you really want both off.

</Callout>

#### Server-set cookies are HttpOnly, SameSite=Lax and Secure

`secureCookies` now defaults to `true`, so every cookie written through `cookies.set()` on the server gets `HttpOnly`, `SameSite=Lax`, and — outside development — `Secure`.

**Symptoms**

- A cookie the server sets is no longer in `document.cookie`, so client code reads `undefined`.
- A client-side `cookies.set()` or `cookies.delete()` on that name does nothing, with no error. Mochi logs `cookies.set("…") had no effect in the browser`.
- In production over plain HTTP (an internal tool, a bare IP), **no** jar cookies are set at all — browsers drop `Secure` cookies on `http://`.

**Find the affected cookies.** Any name written on the server and touched in the browser:

```sh
# server writes
grep -rn "cookies.set(" src --include=*.ts
# browser reads/writes of the same names
grep -rn "cookies.get(\|cookies.set(\|cookies.delete(" src --include=*.svelte
```

**Fix** — opt out per cookie, keeping the default for everything else:

```ts
cookies.set('theme', theme, { path: '/', httpOnly: false }); // island reads and rewrites this
cookies.set('session', token, { path: '/' }); // stays HttpOnly
```

**Revert** — `Mochi.serve({ secureCookies: false })`, or reshape the baseline for every cookie with the `cookie:defaults` filter:

```ts
filters: {
  'cookie:defaults': (defaults) => ({ ...defaults, secure: false }), // keep HttpOnly, drop Secure
}
```

<Callout type="info">

`HttpOnly` also stops JavaScript **overwriting or deleting** the cookie, not just reading it. A double-submit CSRF token (`XSRF-TOKEN`-style) needs `{ httpOnly: false }` even though it looks like a security cookie — the pattern depends on client JS reading it back. See [Secure cookies](/docs/security/#secure-cookies).

</Callout>

#### Cross-origin WebSocket upgrades are rejected in production

`Mochi.ws` upgrades are now origin-checked like form POSTs, closing Cross-Site WebSocket Hijacking.

**Symptom.** The upgrade returns `403` in production and the log reads `CSRF: blocking WebSocket upgrade /path — origin https://other.example does not match expected …`. In development the same case only warns, so this first appears after deploying.

**Fix** — list the origins allowed to open sockets:

```ts
await Mochi.serve({
  proxy: { origin: 'https://example.com' },
  csrf: { trustedOrigins: ['https://app.partner.com'] },
  routes,
});
```

**Revert** — `csrf: { checkOrigin: false }`, which also turns off the form-POST CSRF check.

Upgrades with **no** `Origin` header are unaffected: server-to-server clients, native apps and CLIs never carried ambient cookies to steal.

#### `redirect()` may not send visitors off-origin

An off-origin `redirect()` location is blocked with `500` in production (logged, allowed in development), closing open-redirect phishing through values like `?next=`.

**Symptom.** A `500` where a redirect used to happen, and `Blocking redirect(): off-origin location "https://…"` in the log.

**Fix** — pick whichever matches the destination:

```ts
// Known ahead of time: allow the origin once, for the whole app.
await Mochi.serve({ redirect: { trustedOrigins: ['https://accounts.google.com'] }, routes });

// Computed per request, and built by your own code — never from request data.
return redirect(303, `${tenant.ssoEndpoint}?state=${state}`, { external: true });
```

There is no blanket off switch — an app-wide "allow any redirect" is the vulnerability itself. `redirect.trustedOrigins` is the app-wide answer.

<Callout type="danger">

Do not reach for `{ external: true }` to silence a `500` on a location that came from a query parameter, form field or header. That is precisely the open redirect the guard exists to stop — allow-list the origin instead.

</Callout>

With no `proxy.origin`/`proxy.hostHeader` configured, the only evidence of your own origin is the client's `Host` header, so production blocks **every** absolute location. Relative paths (`/dashboard`) keep working. Set `proxy.origin` — CSRF requires it too.

Two more locations the guard now rejects, neither fixable with `trustedOrigins`:

- **Control characters.** Any code point `<= 0x1F` or `0x7F` — tab, vertical tab, `DEL` — fails before the origin rules and before `{ external: true }`, because a newline in a `Location` splits the response. Only CR/LF/NUL threw on 0.9.1. Percent-encode the value before passing it.
- **Non-`http(s)` schemes.** `mailto:`, `tel:` and custom app schemes have no origin to match, so they read as off-origin. Use `redirect(303, 'mailto:…', { external: true })`.

#### Baseline security headers on every response

`X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` are now sent on pages, APIs, SSE, server islands, `Mochi.file` routes, `publicDir` files and error pages.

Neither changes how a correct app behaves; this is listed for completeness. Two exceptions:

- `nosniff` means a file served with the wrong `Content-Type` is no longer rescued by browser MIME sniffing. A stylesheet served as `text/plain` stops applying.
- `Referrer-Policy` sends only the origin cross-site. Analytics or an affiliate integration that wants the full referrer path needs `securityHeaders: { referrerPolicy: 'no-referrer-when-downgrade' }`.

**Revert** — `securityHeaders: false`, or drop one with `{ contentTypeOptions: false }` / `{ referrerPolicy: false }`.

`X-Frame-Options` is **not** among the defaults — it cannot express an allow-list. Use CSP `frame-ancestors`, or opt in with `securityHeaders: { frameOptions: 'SAMEORIGIN' }`.

### Queues were rebuilt on bun-boss

The largest API change in the release. `Mochi.queue()` moved from bunqueue to bun-boss, and there is no opt-out — every queue call site needs editing.

```ts
// 0.9.1
const emails = Mochi.queue({ name: 'emails', process: sendEmail });
await Mochi.serve({ queues: { emails }, routes });
await emails.add('send', { to }, { delay: 30_000, attempts: 3, jobId: key });

// 0.10.0
const emails = Mochi.queue('emails', { process: sendEmail });
await Mochi.serve({ queues: [emails], routes });
await emails.add({ to }, { startAfter: 30, retryLimit: 3, id: key });
```

| 0.9.1                                           | 0.10.0                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `Mochi.queue({ name, … })`                      | `Mochi.queue(name, { … })`                                    |
| `queues: { emails }`                            | `queues: [emails]`                                            |
| `add(name, data, opts)`                         | `add(data, opts)`, returns `string \| null` not `MochiJobRef` |
| `delay` (milliseconds)                          | `startAfter` (**seconds**, or a `Date`)                       |
| `attempts`                                      | `retryLimit`                                                  |
| `jobId`                                         | `id`                                                          |
| `bunqueue` passthrough                          | `Mochi.boss()`                                                |
| `dataPath`, `lockDuration`, `defaultJobOptions` | removed                                                       |

**Symptom.** `Mochi.serve({ queues }): every element must be a descriptor created with Mochi.queue(name, …).` at boot, or a typecheck failure on `add()`.

**Removed exports:** `MochiJobRef`, `DEFAULT_LOCK_DURATION_MS`, `DEFAULT_RECOVERY_STALL_WARNING_MS`. **Removed filters:** `queue:lockDurationMs` and `queue:recoveryStallWarningMs`, replaced by `queue:expireInSeconds`.

<Callout type="warning">

**Jobs now retry twice by default** (`retryLimit: 2`, so up to three runs). A non-idempotent processor that relied on the old at-most-once behaviour needs `retryLimit: 0`. Active-job expiry also drops from 30 to 15 minutes — a processor that runs longer than that has its job reclaimed.

</Callout>

**On disk:** the storage schema is entirely different, so jobs pending in a 0.9.1 store are stranded — drain the old queue before upgrading. Queue names must now match `/^[\w.\-/]+$/` and may not start with `cron-`. Config drift against an existing store throws at boot (`… already exists in storage with …, but this code declares …`); pass `queueConfig: 'sync'` to adopt the declared config instead.

`jobName` was dropped from all four `queue:*` event payloads.

### Routing

#### `trailingSlash` applies to page routes only

`Mochi.api()`, `Mochi.sse()`, `Mochi.ws()` and `Mochi.file()` routes no longer mirror or redirect the alternate slash form — only pages do.

**Symptom.** The alt-slash form of an API or SSE route is a hard `404` where it used to `301`/`308`. A client hardcoded to the old redirect target breaks; a WebSocket client on the wrong form sees an opaque connection failure.

**Fix** — register both forms against the same route value:

```ts
const handler = Mochi.api(() => Response.json({ ok: true }));
export const routes = { '/api/status': handler, '/api/status/': handler };
```

#### Unmatched paths are no longer slash-normalized

`trailingSlash` fires only on a matched page route, not on the catch-all.

**Symptom.** Under `trailingSlash: 'always'`, `/nope` returns `404` where it used to `301` to `/nope/`. A `POST` to a page with no `actions` now `404`s instead of `308`-ing. The `trailingSlash:redirect` filter no longer runs for unmatched paths.

**Fix** — normalize in your `fetch` fallback or a `handle` if you depended on it.

#### `serverProps` results are enforced

- `redirect()` returned from `serverProps` now issues a real `3xx` instead of being spread into props. A route that quietly rendered `200` becomes a redirect.
- `fail()` or `success()` returned from `serverProps` now throws: `[mochi] Route "/x" serverProps returned fail() — those are form-action results.`
- The redirect marker was renamed `__mochiFormRedirect` → `__mochiRedirect`, and the type `MochiFormRedirect` → `MochiRedirect`. Duck-typed wrappers around actions stop recognising redirects.

### Islands and components

Three patterns that used to compile are now fatal errors, each caught at build time with the offending file and component named.

- **Children on a `mochi:hydrate` island.** `<Counter mochi:hydrate>…</Counter>` fails: an island hydrates from serialized props alone, so children cannot cross the server→client boundary. Move the content inside the island, or use `mochi:defer`.
- **`.server.svelte` marked hydratable.** The suffix now carries framework meaning — the client build replaces such a component with a throwing stub. Rename the file if the name was incidental.
- **`mochi:defer` inside a `mochi:hydrate*` subtree.** A server island cannot exist inside a subtree that re-renders on the client.

**`inlineNestedIslands` now defaults to `true`.** A chain of nested `mochi:defer` islands resolves in one `/_mochi/island/:name` request instead of one per level, so nested islands no longer have their own wrapper — per-child caching, auth and timing disappear. Opt out with `Mochi.serve({ inlineNestedIslands: false })` or per call site with `mochi:defer={{ inline: false }}`.

### Assets and build output

- **`compress()` dropped brotli.** `CompressionMethod` is now `'gzip' | 'zstd' | 'deflate'`, and the default is `['zstd', 'gzip']` — modern browsers get `Content-Encoding: zstd`. A CDN, proxy or WAF that does not understand zstd passes through an unreadable body with no error. `compress({ methods: ['brotli', 'gzip'] })` logs `compress(): ignoring unsupported method(s) brotli`; `methods: ['brotli']` alone silently disables compression. Nearest revert: `compress({ methods: ['gzip'] })`. `brotliQuality` was removed.
- **Fonts imported through CSS are emitted as separate assets.** `import '@fontsource/…'` no longer inlines every face as base64: faces over 4 KB are served from `/_mochi/fonts/…`, legacy `woff` sources are pruned when `woff2` exists, and up to eight `<link rel="preload" as="font" crossorigin>` tags are injected. A CSP `font-src` scoped to `data:` will now block them. Partial revert: `fonts: { inlineThreshold: Infinity, dropLegacyWoff: false, preload: false }`.
- **Imported CSS bundles are minified.** Served bytes and the content hash in every `/_mochi/import-css/*.css` filename change. No opt-out.
- **`@font-face` is stripped from rendered emails.** Email clients ignore them or clip the message on size, so a template that shipped one now renders with fallback fonts. Logged, no opt-out.

### Smaller changes

- **`memoryPressure` defaults to `true`.** In production Mochi listens for the OS memory-pressure signal; on Linux and Windows it only arrives as `critical`, which clears **every** `MemoryStorage` cache — not just stale entries. Opt out with `memoryPressure: false`.
- **`svelte-shaker` is now an optional peer.** An app using `optimize` still builds, but bundles get larger with one warning. Install `@mochi-framework/svelte-shaker` to restore it.
- **`runTests()` concurrency** defaults to a cap of 6 rather than `hardwareConcurrency` (and 1 on Windows). Set `MOCHI_MAX_CONCURRENCY=max` for the old behaviour.
- **Type narrowings.** `MochiServerStopEvent.reason` gained `'stop'` alongside `'signal'`, and `mochi:shutdown`'s `signal` is now optional. Exhaustive switches and non-optional reads fail typecheck.
- **`create-mochi` scaffolds ESLint and Prettier** by default, including in non-interactive runs. Opt out with `--no-eslint --no-prettier`.

### Not breaking

Added in 0.10.0, off unless you ask for them: the `csp` option and `getCspNonce()`, the `securityHeaders` and `redirect` serve options, `staticDirs`, `cron`, and the `websocket` option for Bun's per-socket limits. See [Security](/docs/security/).
