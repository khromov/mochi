---
title: 'Captcha'
slug: captcha
description: 'Slide-to-verify captcha with proof-of-work, replay protection and no third-party service.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
</script>

## Captcha

`<MochiCaptcha />` is a slide-to-verify widget that gates form submissions without a third-party service, a tracker, or a network round-trip. Mint a challenge in `serverProps`, render the component, verify in the action.

```ts
// src/routes.ts
import { Mochi, fail, success, mintCaptcha, verifyCaptcha } from 'mochi-framework';

export const routes = {
  '/contact': Mochi.page('./src/Contact.svelte', {
    serverProps: () => ({ captcha: mintCaptcha() }),
    actions: {
      send: async ({ formData }) => {
        const captcha = await verifyCaptcha(formData);
        if (!captcha.ok) {
          return fail(400, { error: captcha.error });
        }
        return success();
      },
    },
  }),
};
```

`mintCaptcha()` returns `{ token, bits }` — spread it straight onto the component. The widget adds its own `captcha_token` and `captcha_pow` hidden inputs to the surrounding form, so `verifyCaptcha(formData)` needs nothing else.

```svelte
<script lang="ts">
  import { MochiCaptcha } from 'mochi-framework/components';
  import type { MintedCaptcha } from 'mochi-framework';

  let { captcha }: { captcha: MintedCaptcha } = $props();
  let verified = $state(false);
</script>

<form method="POST" action="?/send">
  <input name="email" type="email" required />
  <MochiCaptcha {...captcha} bind:verified />
  <button type="submit" disabled={!verified}>Send</button>
</form>
```

`bind:verified` is optional — bind it to disable submit until the challenge is solved. The server rejects unsolved submissions either way.

### How it works

Sliding the handle advances a SHA-256 hash chain one link per step. The final link is the proof-of-work challenge, and the widget then brute-forces a nonce whose digest has `bits` leading zeros.

The challenge is never in the page — it only exists once the slide progression has actually run. A bot that reads the token out of the HTML and solves a proof-of-work against it directly fails, because the server re-derives the chain and checks the work against its final link.

The token itself is encrypted and authenticated (AES-256-SIV, keyed from `MOCHI_KEY`) and seals the mint time, a one-time nonce, and the difficulty. So a passing submission proves the page was really fetched, the widget really ran, and real hashing work was really spent.

Difficulty is sealed **inside** the token, not passed alongside it: `verifyCaptcha()` always checks the difficulty a token was minted at, so raising `bits` can never silently invalidate or weaken tokens already in flight.

<Callout type="warning">

**Set `MOCHI_KEY` in production.** Tokens are sealed with a key derived from it. Without it Mochi generates a random key per boot, so every in-flight challenge breaks on restart and no two instances accept each other's tokens. Generate one with `bunx mochi-framework generate-key`.

</Callout>

### Options

Configure defaults on `Mochi.serve()`:

```ts
await Mochi.serve({
  captcha: {
    bits: 16,
    minAgeMs: 2000,
    maxAgeMs: 900_000,
    store: 'memory',
  },
  routes,
});
```

| Option      | Default                        | Description                                                                     |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `bits`      | `16`                           | Proof-of-work difficulty in leading zero bits. Each extra bit doubles the work. |
| `minAgeMs`  | `2000`                         | Reject tokens younger than this — a human can't fill a form instantly.          |
| `maxAgeMs`  | `900_000`                      | Reject tokens older than this (15 minutes).                                     |
| `store`     | `'memory'`                     | One-time nonce store: `'memory'`, `'sqlite'`, or your own `NonceStore`.         |
| `storePath` | `.mochi/captcha-nonces.sqlite` | SQLite file when `store: 'sqlite'`.                                             |

Every token failure returns the same message, so a probing bot can't tell "too fast" from "tampered" and learn where the limits are.

### Replay protection

A solved token is single-use. `verifyCaptcha()` burns its nonce on success; a second submission of the same token is rejected.

<Callout type="warning">

**The default `'memory'` store is per-process.** It gives no replay protection across a multi-instance deploy. Use `store: 'sqlite'` with shared storage, or supply your own `NonceStore` backed by Redis or your database.

</Callout>

```ts
import type { NonceStore } from 'mochi-framework';

const store: NonceStore = {
  // Return false if the nonce was already spent. Must be atomic.
  consume: async (nonce, expiresAt) => (await redis.set(nonce, '1', { NX: true, PXAT: expiresAt })) === 'OK',
};
```

Pass `{ consume: false }` when other validation could still reject the submission, then burn the nonce yourself once you commit. This way a fixable mistake — a typo'd email — doesn't cost the visitor their solved captcha, while a retried failure downstream can't double-submit:

```ts
send: async ({ formData }) => {
  const captcha = await verifyCaptcha(formData, { consume: false });
  if (!captcha.ok) {
    return fail(400, { error: captcha.error });
  }
  if (!isValidEmail(formData.get('email'))) {
    return fail(400, { error: 'Enter a valid email address.' }); // nonce survives
  }
  if (!(await consumeCaptcha(captcha))) {
    return fail(400, { error: 'Already submitted. Reload to send another.' });
  }
  await sendIt();
  return success();
},
```

### Theming

The widget ships self-contained defaults. Override any of them from an ancestor:

```css
.my-form {
  --mochi-captcha-accent: #4a7c59;
  --mochi-captcha-accent-soft: #e0ebe1;
  --mochi-captcha-accent-soft-text: #2f5b3f;
  --mochi-captcha-border: #e8e4d8;
  --mochi-captcha-track-bg: #faf8f1;
  --mochi-captcha-handle-bg: #fffdf8;
  --mochi-captcha-hint-text: #6e756d;
}
```

### Testing

`solveCaptcha()` returns the exact fields the widget would submit, so form tests don't need a browser. Lower `bits` in the test server — solving at the production default costs real work.

```ts
import { mintCaptcha, solveCaptcha } from 'mochi-framework';

await Mochi.serve({ captcha: { bits: 8, minAgeMs: 0 }, routes, port: 0 });

const res = await fetch(`${base}/contact/?/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ...solveCaptcha(mintCaptcha()), email: 'ada@example.com' }),
});
```

### API

| Export                              | Returns                          | Description                                                                      |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `mintCaptcha(options?)`             | `{ token, bits }`                | Mint a single-use challenge. `options.bits` overrides the configured difficulty. |
| `verifyCaptcha(formData, options?)` | `Promise<CaptchaResult>`         | Verify and (unless `consume: false`) burn the nonce.                             |
| `consumeCaptcha(result)`            | `Promise<boolean>`               | Burn a deferred nonce; `false` if already spent.                                 |
| `solveCaptcha(minted)`              | `{ captcha_token, captcha_pow }` | Solve server-side, for tests.                                                    |

`CaptchaResult` is `{ ok: true; nonce: string; expiresAt: number }` or `{ ok: false; error: string }` — `error` is safe to show to the visitor.

<Callout type="info">

Solving requires JavaScript: the widget is a hydrated island. Give non-JS visitors another route to you — a `<noscript>` block with a mailto link — since the form can't be completed without it.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/captcha/", title: "Captcha", hook: "Slide-to-verify with a hash chain and proof-of-work — no third party, no tracking." },
]}
/>
