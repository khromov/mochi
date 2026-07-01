---
title: 'Transforming HTML with transformPage'
slug: transform-page
description: 'Rewrite rendered HTML before it is sent to the client using the transformPage callback.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## `transformPage`

Pass `transformPage` to `resolve(event, { transformPage })` inside a `Handle` to rewrite the rendered HTML before it ships. It runs once per response, only on `text/html` bodies, with the full HTML string and `done: true`.

```ts
// file: src/hooks.ts
import type { Handle } from 'mochi-framework/hooks';

const greeting: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html }) {
      return html.replace('{{app.greeting}}', 'Welcome to Mochi!');
    },
  });
};
```

```html
<!-- file: src/shell.html -->
<body>
  <header>{{app.greeting}}</header>
  {{mochi.body}}
</body>
```

The callback receives `{ html, done }` and returns `string | undefined | Promise<string | undefined>`. Returning `undefined` replaces the body with an empty string.

```ts
const banner: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    async transformPage({ html }) {
      const message = await fetchBannerMessage();
      return html.replace('{{app.banner}}', message);
    },
  });
};
```

Use it for per-request mutations the shell template can't express on its own — request-aware `<html lang>`, nonce injection, A/B placeholder swaps:

```ts
const lang: Handle = async ({ event, resolve }) => {
  const locale = event.request.headers.get('accept-language')?.slice(0, 2) ?? 'en';
  return resolve(event, {
    transformPage({ html }) {
      return html.replace('<html', `<html lang="${locale}"`);
    },
  });
};
```

The callback is invoked **once with the full HTML**, not streamed chunk-by-chunk; `done` is always `true`. Treat it as a whole-document transform.

When `sequence()` chains multiple handlers, transforms run inner-most first and outer-most last — the handler closest to the route sees the original HTML, the outermost wraps the final result.

<Callout type="info">

**Reserve `transformPage` for request-dependent values.** Static markup belongs in `src/shell.html` (or the default shell) so it ships without per-request work; use transforms only for values that genuinely depend on the request.

</Callout>
