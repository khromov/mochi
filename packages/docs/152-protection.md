---
title: 'Protection Mode'
slug: protection
ogTitle: 'Browser-verification interstitial'
description: 'Cloudflare-style browser verification on your own infrastructure: an interstitial auto-solves the captcha proof-of-work and redeems it for a signed clearance cookie.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Protection Mode

<VersionNote since="0.10.0" message="Protection mode ships in 0.10.0." />

Protection mode gates routes behind a browser check, like Cloudflare's "verifying your browser" page but on your own infrastructure. An unverified client gets a **403 interstitial** instead of the page: a hidden `<MochiCaptchaAuto />` island runs the [captcha](/docs/captcha/)'s hash chain and proof-of-work immediately — no slider — posts the solution to a built-in endpoint, receives a signed `HttpOnly` clearance cookie, and reloads into the real page. Every later request passes until the clearance expires.

```ts
await Mochi.serve({
  protection: { enabled: true },
  routes,
});
```

That alone protects **every** route — pages, APIs, WebSockets, SSE, and unmatched URLs handled by your `fetch` fallback.

### Choosing what to protect

`protect()` runs on every request; return `true` to gate it. It receives `{ kind, path, url, request }`, so branching on route kind or path prefix is one line:

```ts
protection: {
  enabled: true,
  // Only APIs need verification; pages stay open.
  protect: ({ kind }) => kind === 'api',
},
```

`kind` is `'page' | 'api' | 'ws' | 'sse' | 'island' | 'file' | 'fallback'`. A `protect()` that throws counts as protected (fail closed).

Never gated, regardless of `protect()`: framework client assets (the interstitial must load its own JS/CSS), `publicDir` files, warmup self-requests, the verify endpoint itself, and unmatched 404s with no `fetch` fallback.

### What a blocked client sees

| Kind                          | Response                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| `page`, `fallback`            | The interstitial HTML — `403`, `Cache-Control: no-store`   |
| `api`                         | `403` JSON: `{ "error": "Browser verification required" }` |
| `ws`, `sse`, `island`, `file` | Plain `403`                                                |

A browser calling a protected API from an already-cleared page carries the cookie automatically, so in practice only direct, cookie-less clients see the API 403.

### Options

```ts
protection: {
  enabled: true,
  protect: ({ path }) => path.startsWith('/members'),
  bits: 19,                    // PoW difficulty; default: the captcha bits (19)
  maxAgeMs: 4 * 60 * 60 * 1000, // clearance lifetime; default 4 hours
  shellPage: './src/protection-shell.html', // custom interstitial shell
},
```

- **`bits`** — proof-of-work difficulty in leading zero bits; each extra bit doubles the expected work. Defaults to the resolved [captcha](/docs/captcha/) `bits`, so one setting tunes both.
- **`maxAgeMs`** — how long a passed verification lasts. The clearance is a sealed `{ iat }` token in the `_mochi_clearance` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` on https); both the cookie's `Max-Age` and the server-side check use this value. It's keyed off `MOCHI_KEY`, so clearances survive restarts and work across instances.
- **`shellPage`** — a path ending in `.html` or an inline HTML string with the `{{mochi.head}}` / `{{mochi.css}}` / `{{mochi.body}}` / `{{mochi.script}}` placeholders, replacing the built-in centered-column shell around the interstitial.

### How a verification runs

1. The gate finds no valid clearance and answers the request with the interstitial (`mintCaptcha()` seals the challenge at the protection `bits`).
2. `<MochiCaptchaAuto />` hydrates, walks the 10-link hash chain, brute-forces the proof-of-work in yielding slices, and POSTs `captcha_token` + `captcha_pow` to `/_mochi/protection/verify`.
3. The endpoint verifies with the captcha machinery (the one-time nonce makes each solution single-use) and answers `Set-Cookie: _mochi_clearance=…`.
4. The widget reloads; the original URL now passes the gate.

The timing floor that guards captcha _forms_ (`minAgeMs`, default 2s) does not apply here — there is nothing to fill in, so the verify endpoint accepts an instant solve.

<Callout type="warning">

In production the verify POST goes through the same origin-header CSRF check as every Mochi form, so `proxy.origin` (or `proxy.hostHeader`) must be configured — without it verification always fails and protected pages loop on the interstitial.

</Callout>

<Callout type="info">

Blocked interstitials are `no-store` and cleared responses carry `Vary: Cookie`, but don't edge-cache protected routes on a CDN that ignores cookies — a cached response would bypass the gate. Protection options are read once at boot; changing them needs a restart.

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

Lower `captcha: { bits: 8 }` in the test server so the solve takes milliseconds.

<SeeItInAction
demos={[
{ href: "/demos/protection/", title: "Protection Mode", hook: "A Cloudflare-style browser check — the interstitial auto-solves the proof-of-work and redeems it for a clearance cookie." },
]}
/>

### API

| Export                                            | What it is                                     |
| ------------------------------------------------- | ---------------------------------------------- |
| `PROTECTION_CLEARANCE_COOKIE`                     | The clearance cookie name (`_mochi_clearance`) |
| `DEFAULT_PROTECTION_MAX_AGE_MS`                   | Default clearance lifetime (4 hours)           |
| `MochiProtectionOptions`                          | The `Mochi.serve({ protection })` option type  |
| `MochiProtectionContext` / `MochiProtectionKind`  | What `protect()` receives                      |
| `MochiCaptchaAuto` (`mochi-framework/components`) | The auto-solving widget the interstitial uses  |
