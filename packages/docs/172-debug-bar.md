---
title: 'Debug bar'
slug: debug-bar
description: 'A floating dev toolbar showing hydration metrics, request data, island breakdown, and bundle stats.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import debugBar from './images/debug-bar.png';
  import debugBarIslands from './images/debug-bar-islands.png';
</script>

## Debug bar

A floating toolbar pinned to the bottom-right of every page in development. It surfaces hydration cost, request metadata, runtime warnings, and a link to the bundle stats page. `Mochi.serve()` mounts it automatically whenever `development: true` — there is nothing to wire up.

<figure>
  <Image src={debugBar} size="doc" width={debugBar.width} height={debugBar.height} alt="The Mochi debug bar: a status dot, the mochi wordmark, and buttons for Request, Islands, JS, Info and Cache, plus the email outbox and cogwheel icons" />
  <figcaption>The bar as it sits on a page in development. The toolbar has its own dark styling and does not follow the site's theme.</figcaption>
</figure>

```ts
await Mochi.serve({
  development: process.env.MODE === 'development',
  routes,
});
```

In production (`development: false`) the toolbar mount point, its entry script, and the per-request `window.__mochi_debug` payload are all stripped from the HTML — the bar adds zero bytes to production responses. See [development mode](/docs/development-mode/) for the rest of what dev mode turns on.

### Buttons

| Button           | Opens                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| Status dot       | Live-reload connection state — green pulse when connected, red when dropped.       |
| `Request`        | Matched route pattern, pathname, params, response size, `Set-Cookie`s, headers.    |
| `Info`           | Mochi / Svelte / Bun versions and a snapshot of the active `Mochi.serve()` config. |
| `Islands`        | Per-island breakdown with mode tag, props size, and a locate-on-page button.       |
| `Warnings`       | Anything pushed through `window.__mochi_warn(msg)`. Hidden when the queue empty.   |
| `Bundle Stats ↗` | Opens the bundle stats page (`/_mochi/client/stats`) in a new tab.                 |
| `Cache`          | Empty the on-disk [image cache](/docs/images/) in one click (see below).           |
| `⚙`              | Configure which panel buttons appear in the bar (see below).                       |

### Configuring panels

The cogwheel at the right edge of the bar opens a checklist of the panels. Unchecked panels disappear from the bar; the choice persists across reloads in `localStorage` under `mochi:debug:hidden-panels`. At least one panel always stays enabled — the last checked box is disabled. Conditional buttons still respect their availability: re-enabling `Warnings` or `Images` only shows the button once something is queued or an image was produced.

### Islands panel

Lists every `<mochi-hydratable-island>` and `<mochi-server-island>` on the page, grouped by type. Each row shows the component name, its hydration mode (`mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, …), and props size. Click a row to expand the inline props as syntax-highlighted JSON; click the crosshair icon to scroll to the island and flash a cyan outline around it for ~1.5s.

<figure>
  <Image src={debugBarIslands} size="doc" width={debugBarIslands.width} height={debugBarIslands.height} alt="The Islands panel listing hydrated islands with their mochi:hydrate tags, props sizes, shared badges and crosshair buttons, above a summary reading 12 islands, 39.3 kB total props, 8 hydrated, 4 server" />
  <figcaption>The Islands panel. The summary row counts hydrated and server islands separately, and rows sharing a props payload carry a <code>shared</code> badge.</figcaption>
</figure>

The `Islands` button in the bar shows a running total props size and changes color past two thresholds — yellow above **10 KB**, red above **100 KB**. Props payload is the dominant tax on hydration, so this is the number to watch when a page feels heavy. See [passing props to islands](/docs/island-props/) for how to keep payloads small.

When two or more islands ship the exact same props payload, Mochi hoists it into a single shared `<script type="application/json">` block. Those rows show a `shared` badge, and the panel's totals only count the shared payload once.

### Server islands

Server-island rows display a lock icon next to the mode tag. Their props are encrypted before being sent to the client (opaque on the wire and tamper-proof) — the decoded JSON shown in the panel comes from a dev-only sidecar copy. In production no plaintext props leave the server.

### Images panel

Lists every image produced during the request. Deferred URLs from [`<Image>` / `getImageUrl`](/docs/images/) show a lock icon (their `src` + size name are AES-256 encrypted on the wire; the decoded params are a dev-only view) and the size-name tag. Inline [`getImage`](/docs/images/#getimage-inline-bytes-metadata) results show an `inline` tag instead — their preview is the resolved output inlined as a `data:` URL (omitted for outputs over 1 MB). Click a row to expand the preview and params.

### Cache panel

A single **Empty image cache** button that clears the on-disk [image cache](/docs/images/) — every original, resized variant, and blur placeholder — by `POST`ing to the dev-only `/_mochi/image-cache/` endpoint. Useful after tweaking resize settings or replacing a source image, so the next request regenerates from scratch instead of serving a stale variant. The endpoint (and the tab) exist only while the debug bar is enabled, so nothing is exposed in production.

### Warnings

Any code can queue a warning into the toolbar by calling `window.__mochi_warn('message')` from the browser. Mochi uses this internally for soft hydration issues that aren't severe enough to throw. Unread warnings also appear in the page console because `__mochi_warn` keeps the original `console.warn` chained.

### Request panel

Reads its data from `window.__mochi_debug`, which the framework seeds once per response. The HTML size shown in the title is taken from `PerformanceNavigationTiming` — when the response was compressed, both decoded and over-the-wire sizes are shown side by side.

### Info panel

Shows the running **Mochi**, **Svelte**, and **Bun** versions, plus a serializable snapshot of the resolved `Mochi.serve()` config — mode, port, trailing-slash policy, log level, route count, and whether warmup, live-reload, CSRF, proxy, middleware, etc. are active. These values are constant for the server's lifetime, so they're captured once at startup rather than per request. Handy when reporting an issue or confirming which options actually took effect.
