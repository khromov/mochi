---
title: 'Feature Flags'
slug: feature-flags
description: 'Roll features out to a subset of users with Mochi.feature() — deterministic, sticky, and carried by an encrypted cookie.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import SeeItInAction from './_components/SeeItInAction.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Feature Flags

<VersionNote since="0.10.0" message="Feature flags ship in 0.10.0." />

Declare per-user flags in `Mochi.serve({ features })` and check them anywhere in a request with `Mochi.feature(name)`. Assignment is **deterministic and sticky** — the same user always resolves to the same state — and is carried by a single encrypted, opaque cookie (`mochi_ff`).

```ts
Mochi.serve({
  features: {
    'new-checkout': { rollout: 0.25 }, // 25% of users
    beta: {
      rollout: 0, // off by default…
      target: (ctx) => (ctx.locals.user?.isStaff ? true : undefined), // …but always on for staff
    },
  },
  routes,
});
```

Each flag is:

- `rollout` — a fraction in `[0, 1]`. Assignment is a deterministic hash of the flag name and the user's opaque cookie seed, so raising `rollout` only ever _adds_ users (nobody who had it loses it).
- `target` — an optional predicate evaluated first. Return `true`/`false` to force the flag on/off (bypassing `rollout`); return `undefined` to fall through to bucketing. Use it to target on the logged-in user (`ctx.locals`), the URL, headers, or cookies.

### Checking a flag

In route, API, and handler code (`.ts`), use `Mochi.feature()`:

```ts
Mochi.api(() => Response.json({ checkout: Mochi.feature('new-checkout') ? 'v2' : 'v1' }));
```

Inside a `.svelte` component, import the standalone `feature()`:

```svelte
<script>
  import { feature } from 'mochi-framework';
  const showBeta = feature('beta');
</script>
```

<Callout type="warning">

**Flags are evaluated on the server.** In a **hydrated** island (`mochi:hydrate*`), a top-level `feature()` call would re-run during client hydration, where there's no request — so it throws. Evaluate flags in a **server island**, or check them once in the page and pass the boolean down as a prop.

</Callout>

### How assignment works

The first `feature()` check of a request mints a random bucketing **seed** and stores it in the `mochi_ff` cookie, sealed with the framework secret (the same AES-SIV scheme used for server-island props). The cookie:

- contains **only the opaque seed** (plus any sticky overrides) — never the list of flags a user is in;
- is **encrypted and authenticated**, so a user can't edit it to self-assign into a flag;
- is `HttpOnly` and lasts a year.

Flag state is then derived server-side by hashing the flag name with the seed — no per-flag data is ever stored client-side.

You can pin a user to a specific state (e.g. from an admin toggle) with `setFeatureOverride`, which writes a sticky override into the same encrypted cookie:

```ts
import { setFeatureOverride } from 'mochi-framework';

setFeatureOverride('beta', true); // force on for this user
setFeatureOverride('beta', null); // clear the override, back to bucketing
```

<Callout type="danger">

**Caching proxies must key on the `mochi_ff` cookie.** Because assignment lives in that cookie, a full-page cache or CDN that ignores it will serve the first user's variant to everyone. Any response that checks a flag automatically gets `Vary: Cookie` (Mochi appends it whenever the cookie jar is touched — see [Request Context](/docs/request-context/)), which is the standards-compliant signal, but it is **coarse**: it varies on _all_ cookies, hurting your hit rate. On a CDN, narrow the cache key to just `mochi_ff`:

- **Cloudflare** — add `mochi_ff` to the Cache Key under _Cache Rules_ (`Cache Key → Cookie → mochi_ff`).
- **Fastly (VCL)** — `set req.http.Cache-Key = req.http.Cache-Key + req.http.Cookie:mochi_ff;`
- **Varnish** — `hash_data(cookie_get("mochi_ff", req.http.Cookie));` in `vcl_hash`.

Whichever you use, the `mochi_ff` cookie must reach the origin (don't strip it) and must be part of the cache key.

</Callout>

<Callout type="warning">

Set a stable `MOCHI_KEY` in production. It's the same secret that signs server-island props and image URLs; if it changes (or is randomly generated on each boot), every user's buckets reshuffle. Generate one with `bunx mochi-framework generate-key`.

</Callout>

<SeeItInAction
demos={[
{ href: "/demos/feature-flags/", title: "Feature Flags", hook: "Per-user flags via Mochi.feature() with a sticky, deterministic, encrypted assignment cookie." },
]}
/>
