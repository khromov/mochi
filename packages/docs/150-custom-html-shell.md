---
title: 'Custom HTML shell'
slug: custom-html-shell
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Custom HTML shell

`htmlShell` overrides the default `<!doctype html>` wrapper that Mochi renders pages into. Pass either a path to an `.html` file (detected by the `.html` suffix) or the template string directly:

```ts
// file: src/index.ts
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

await Mochi.serve({
  htmlShell: './src/shell.html',
  routes,
});
```

The default shell lives at `packages/mochi/src/templates/default-shell.html` — copy it as a starting point.

### Placeholders

A custom shell must contain four placeholders. Each is replaced once per request by `Mochi.resolveHtmlShell()`:

| Placeholder        | Replaced with                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `{{mochi.head}}`   | `<svelte:head>` output plus the warning-collector bootstrap script.                                    |
| `{{mochi.css}}`    | Island-display rules, island-failure styles, and `<link rel="stylesheet">` tags for compiled CSS.      |
| `{{mochi.body}}`   | Rendered component HTML, debug-info script, dev toolbar mount, dev error overlay, error-report script. |
| `{{mochi.script}}` | Hydration bootstrap `<script type="module">`, server-island loader, debug bar, and dev live-reload.    |

_Example:_ minimal shell.

```html
<!-- file: src/shell.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {{mochi.head}} {{mochi.css}}
  </head>
  <body>
    {{mochi.body}} {{mochi.script}}
  </body>
</html>
```

Do **NOT** omit a placeholder — every required asset for that slot is silently dropped. Skip `{{mochi.script}}` and hydration, server islands, the debug bar, and dev live-reload all stop working; skip `{{mochi.css}}` and component styles never load; skip `{{mochi.body}}` and the page renders blank.

### When to customize

- Add `<meta>`, `<link rel="icon">`, analytics snippets, or third-party scripts site-wide.
- Set `lang`, `dir`, or class names on `<html>` / `<body>` for theming.
- Inline a fonts preload or a CSP `<meta>` tag.

For per-request HTML mutations (nonces, A/B class names, ENV-derived strings) use `transformPage` inside a `handle`:

```ts
// file: src/hooks.ts
import type { Handle } from 'mochi-framework';

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPage: ({ html }) => html.replace('%nonce%', event.locals.nonce),
  });
```

Do **NOT** read request data inside `htmlShell` — it is loaded once at startup; instead, inject per-request values via `transformPage`.
