---
title: 'Protection Mode'
slug: protection
ogTitle: 'Browser-verification interstitial'
description: 'Cloudflare-style browser verification on your own infrastructure: an interstitial auto-solves the captcha proof-of-work and redeems it for a signed clearance cookie.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
  import ProtectionShellSource from './_components/ProtectionShellSource.svelte';
  import protectionShot from './images/protection.png';
</script>

## Protection Mode

<VersionNote since="0.10.0" message="Protection mode ships in 0.10.0." />

<figure>
  <Image src={protectionShot} size="doc" width={protectionShot.width} height={protectionShot.height} alt="The protection-mode interstitial: the Mochi logo, the text 'Please wait, we're validating your browser...', and the auto-captcha widget solving" />
  <figcaption>The built-in interstitial mid-verification — the widget solves the proof-of-work on its own and reloads into the page.</figcaption>
</figure>

Protection mode gates routes behind a browser check, like Cloudflare's "verifying your browser" page but on your own infrastructure. An unverified client gets a **403 interstitial page**: a hidden `<MochiCaptchaAuto />` island runs the [captcha](/docs/captcha/)'s hash chain and proof-of-work immediately — no slider — posts the solution to a built-in endpoint, receives a signed `HttpOnly` clearance cookie, and reloads into the real page. Every later request passes until the clearance expires.

```ts
await Mochi.serve({
  protection: { enabled: true },
  routes,
});
```

That alone protects **every** route — pages, APIs, WebSockets, SSE, and unmatched URLs handled by your `fetch` fallback.

### Choosing what to protect

`protect()` is an optional callback that runs on every request; return `true` to protect a resource. It receives `{ kind, path, url, request }`, so branching on route kind or path prefix is one line:

```ts
protection: {
  enabled: true,
  // Only APIs need verification; pages stay open.
  protect: ({ kind }) => kind === 'api',
},
```

`kind` is `'page' | 'api' | 'ws' | 'sse' | 'island' | 'file' | 'fallback'`. A `protect()` that throws counts as protected (fail closed).

Never gated, regardless of `protect()`: framework client assets (the interstitial must load its own JS/CSS), the image and local-asset endpoints (their URLs are server-minted and signed), warmup self-requests, the verify endpoint itself, and unmatched 404s with no `fetch` fallback. `publicDir` static files **are** gated (as kind `file`) — set `protectFiles: false` to leave them open. A blocked POST never gets the interstitial — solving one ends in a reload, which would re-submit the form — so non-GET requests fail as JSON instead.

### What a blocked client sees

| Kind                            | Response                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| `page`, `fallback` (GET / HEAD) | The interstitial HTML — `403`, `Cache-Control: no-store`   |
| `api`, and any non-GET request  | `403` JSON: `{ "error": "Browser verification required" }` |
| `ws`, `sse`, `island`, `file`   | Plain `403`                                                |

A browser calling a protected API from an already-cleared page carries the cookie automatically, so in practice only direct, cookie-less clients see the API 403. The non-HTML bodies use `blockedMessage` (default shown above).

### Options

```ts
protection: {
  enabled: true,
  protect: ({ path }) => path.startsWith('/members'),
  bits: 19,                       // PoW difficulty; default 19
  maxAgeMs: 4 * 60 * 60 * 1000,   // clearance lifetime; default 4 hours
  maxAttempts: 5,                 // failed tries before the widget gives up; default 5
  protectFiles: true,             // gate publicDir static files too; default true
  cookieName: '_mochi_clearance', // clearance cookie name; default shown
  blockedMessage: 'Members only', // non-HTML 403 body; string or (ctx) => string
  page: './src/ProtectionShell.svelte', // custom interstitial component
},
```

- **`bits`** — proof-of-work difficulty in leading zero bits; each extra bit doubles the expected work. Default: 19.
- **`maxAgeMs`** — how long a passed verification lasts. The clearance is a sealed `{ iat }` token in the clearance cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` on https); both the cookie's `Max-Age` and the server-side check use this value. It's keyed off `MOCHI_KEY`, so clearances survive restarts and work across instances.
- **`maxAttempts`** — after this many failed verification attempts the widget stops retrying and shows a terminal message instead (the `exhaustedLabel` prop on `<MochiCaptchaAuto />`). The count lives in `sessionStorage`, so closing the tab resets it. Default: 5.
- **`protectFiles`** — also gate `publicDir` static files (they hit `protect()` as kind `file`). Default: `true`.
- **`cookieName`** — rename the clearance cookie. Default: `_mochi_clearance`.
- **`blockedMessage`** — the 403 body blocked non-HTML kinds receive: the `error` field of the api JSON and the plain-text body for `ws`/`sse`/`island`/`file`. A string, or a callback receiving the same context as `protect()`. Default: `"Browser verification required"`.
- **`page`** — a Svelte component rendered as the interstitial, exactly like `errorPage` for error pages. See below.

### Customizing the interstitial

Point `page` at your own Svelte component. It renders through your app's HTML shell, receives `MochiProtectionPageProps` — `{ token, bits, solveBudgetMs, verifyUrl, maxAttempts }` — and only has to spread them onto `<MochiCaptchaAuto />`, which does the solving and submitting.

The built-in default below is a great natural starting point — copy it and restyle. This is the component's live source, read from the installed `mochi-framework`:

<ProtectionShellSource />

<Callout type="warning">

In production the verify POST goes through the same origin-header CSRF check as every Mochi form, so `proxy.origin` (or `proxy.hostHeader`) must be configured — without it every verification fails, and after `maxAttempts` tries visitors are told their browser couldn't be verified.

</Callout>

<Callout type="info">

Caching a protected route — Mochi's cache or a CDN — only works if the cache key varies on the clearance cookie (`Vary: Cookie`, honoring `_mochi_clearance` or your `cookieName`). A cache that ignores it will serve cached pages to unverified visitors, bypassing the gate entirely.

</Callout>

### Testing protected routes

`solveCaptcha()` solves a minted challenge server-side, so a test can clear itself without a browser:

```ts
import { mintCaptcha, solveCaptcha } from 'mochi-framework';

const fields = solveCaptcha(mintCaptcha());
const form = new FormData();
form.set('captcha_token', fields.captcha_token);
form.set('captcha_pow', fields.captcha_pow);
const res = await fetch(`${base}/_mochi/protection/verify`, { method: 'POST', body: form, headers: { origin: base } });
const cookie = res.headers.get('Set-Cookie'); // send this on protected requests
```

Lower `captcha: { bits: 8 }` in the test server so the solve takes milliseconds. Mind that the verify endpoint refuses tokens minted below the protection difficulty — if you set `protection.bits` above the captcha default, mint with `mintCaptcha({ bits })` to match.

<SeeItInAction
demos={[
{ href: "/demos/protection/", title: "Protection Mode", hook: "A Cloudflare-style browser check — the interstitial auto-solves the proof-of-work and redeems it for a clearance cookie." },
]}
/>

### API

| Export                                            | What it is                                    |
| ------------------------------------------------- | --------------------------------------------- |
| `PROTECTION_CLEARANCE_COOKIE`                     | The default clearance cookie name             |
| `DEFAULT_PROTECTION_MAX_AGE_MS`                   | Default clearance lifetime (4 hours)          |
| `DEFAULT_PROTECTION_MAX_ATTEMPTS`                 | Default verification attempt cut-off (5)      |
| `MochiProtectionOptions`                          | The `Mochi.serve({ protection })` option type |
| `MochiProtectionContext` / `MochiProtectionKind`  | What `protect()` receives                     |
| `MochiProtectionPageProps`                        | Props a custom `page` component receives      |
| `PROTECTION_SHELL_COMPONENT`                      | Absolute path of the built-in interstitial    |
| `MochiCaptchaAuto` (`mochi-framework/components`) | The auto-solving widget the interstitial uses |
