---
title: 'Transforming HTML with transformPage'
slug: transform-page
description: 'Rewrite rendered HTML before it is sent to the client with the transformPage callback.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## `transformPage`

Pass `transformPage` to `resolve(event, { transformPage })` inside a `Handle` to rewrite the rendered HTML before it ships. It runs once per response, only on `text/html` bodies, with the full HTML string and `done: true`.

```ts
// file: src/hooks.ts
import type { Handle } from 'mochi-framework';

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

The callback receives `{ html, done, kind }` and returns `string | undefined | Promise<string | undefined>`. Returning `undefined` replaces the body with an empty string.

### `kind`

<VersionNote since="0.10.0" message="`kind` is new. Earlier versions passed only `{ html, done }` and never ran `transformPage` on island fragments." />

`kind` says which HTML surface you were handed:

| Value              | What it is                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| `'page'`           | A whole document: a `Mochi.page` render, the error page, or `fetch`-fallback HTML |
| `'deferredIsland'` | The HTML fragment a `/_mochi/island/*` request returns                            |

Files served straight from disk — `publicDir` and `Mochi.file()` — are your own bytes and never reach `transformPage`.

Branch on it whenever the transform injects markup rather than filling a placeholder. A fragment is written into the page with `innerHTML`, so a `<script>` appended to one runs again for every deferred island on the page:

```ts
const analytics: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    transformPage({ html, kind }) {
      if (kind !== 'page') return html;
      return html.replace('</body>', `${ANALYTICS_SCRIPT}</body>`);
    },
  });
};
```

A placeholder swap needs no guard — the placeholder only exists in the shell, so the replace misses on a fragment.

Use `transformPage` for per-request mutations the shell template cannot express: a request-aware `<html lang>`, nonce injection, or A/B placeholder swaps.

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

Mochi invokes the callback once with the full HTML, not chunk by chunk. `done` is always `true`. Treat it as a whole-document transform.

When `sequence()` chains handlers, transforms run inner-most first and outer-most last. The handler closest to the route sees the original HTML. The outermost wraps the final result.

<Callout type="info">

**Use `transformPage` for request-dependent values only.** Static markup belongs in `src/shell.html` (or the default shell) so it ships without per-request work.

</Callout>
