---
title: 'Debug bar'
slug: debug-bar
description: 'A floating dev toolbar showing hydration metrics, request data, island breakdown, and bundle stats.'
---

## Debug bar

A floating toolbar pinned to the bottom-right of every page in development. It surfaces hydration cost, request metadata, runtime warnings, and a link to the bundle stats page. `Mochi.serve()` mounts it automatically whenever `development: true` — there is nothing to wire up.

```ts
await Mochi.serve({
  development: process.env.MODE === 'development',
  routes,
});
```

In production (`development: false`) the toolbar mount point, its entry script, and the per-request `window.__mochi_debug` payload are all stripped from the HTML — the bar adds zero bytes to production responses. See [development mode](development-mode) for the rest of what dev mode turns on.

### Buttons

| Button           | Opens                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| Status dot       | Live-reload connection state — green pulse when connected, red when dropped.     |
| `Request`        | Matched route pattern, pathname, params, response size, `Set-Cookie`s, headers.  |
| `Islands`        | Per-island breakdown with mode tag, props size, and a locate-on-page button.     |
| `Warnings`       | Anything pushed through `window.__mochi_warn(msg)`. Hidden when the queue empty. |
| `Bundle Stats ↗` | Opens the bundle stats page (`/_mochi/client/stats`) in a new tab.               |

### Islands panel

Lists every `<mochi-hydratable-island>` and `<mochi-server-island>` on the page, grouped by type. Each row shows the component name, its hydration mode (`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, …), and props size. Click a row to expand the inline props as syntax-highlighted JSON; click the crosshair icon to scroll to the island and flash a cyan outline around it for ~1.5s.

The `Islands` button in the bar shows a running total props size and changes color past two thresholds — yellow above **10 KB**, red above **100 KB**. Props payload is the dominant tax on hydration, so this is the number to watch when a page feels heavy. See [passing props to islands](island-props) for how to keep payloads small.

When two or more islands ship the exact same props payload, Mochi hoists it into a single shared `<script type="application/json">` block. Those rows show a `shared` badge, and the panel's totals only count the shared payload once.

### Server islands

Server-island rows display a lock icon next to the mode tag. Their props are encrypted before being sent to the client (opaque on the wire and tamper-proof) — the decoded JSON shown in the panel comes from a dev-only sidecar copy. In production no plaintext props leave the server.

### Warnings

Any code can queue a warning into the toolbar by calling `window.__mochi_warn('message')` from the browser. Mochi uses this internally for soft hydration issues that aren't severe enough to throw. Unread warnings also appear in the page console because `__mochi_warn` keeps the original `console.warn` chained.

### Request panel

Reads its data from `window.__mochi_debug`, which the framework seeds once per response. The HTML size shown in the title is taken from `PerformanceNavigationTiming` — when the response was compressed, both decoded and over-the-wire sizes are shown side by side.
