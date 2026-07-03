---
title: 'Images'
slug: images
description: 'On-the-fly image resizing on Bun.Image with encrypted URLs and a stale-while-revalidate disk cache.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Images

Mochi resizes images on the fly with [`Bun.Image`](https://bun.com/docs/runtime/image), serving them from an encrypted, stale-while-revalidate disk cache. Every URL's payload is encrypted (authenticated encryption keyed off your `MOCHI_KEY`), so the source URL and params aren't readable and an attacker can't request arbitrary sources through your server.

### Component

Import `Image` and point it at a source. It renders a single `<img>` with an encrypted, resized `src` — no client JS:

```svelte
<script>
  import { Image } from 'mochi-framework/image';
</script>

<Image src="https://example.com/photo.jpg" width={640} height={400} alt="A photo" />
```

Add `placeholder` to render a [ThumbHash](https://evanw.github.io/thumbhash/) blur that shows until the image loads. It's set as the `<img>`'s own `background-image`, so it needs no client JS — the loaded image paints over it and sharpens in via a CSS blur-up animation (disabled under `prefers-reduced-motion`):

```svelte
<Image src="https://example.com/photo.jpg" width={640} height={400} alt="A photo" placeholder />
```

| Prop                   | Default    | Notes                                                                  |
| ---------------------- | ---------- | ---------------------------------------------------------------------- |
| `src`                  | —          | http/https source URL (required)                                       |
| `width` / `height`     | —          | Target size; height-only derives width by ratio. Must be positive      |
| `alt`                  | `''`       | Always set this                                                        |
| `format`               | `webp`     | `webp` \| `jpeg` \| `png` \| `avif`                                    |
| `quality`              | `80`       | 1–100 (ignored for `png`)                                              |
| `fit`                  | `inside`   | `inside` keeps aspect & fits within W×H; `fill` stretches to exact W×H |
| `placeholder`          | `false`    | Blur-up via an inline `background-image`; pure SSR, no client JS       |
| `loading` / `decoding` | lazy/async | Passed through to `<img>`                                              |

> `Bun.Image` supports only `fit: 'inside'` and `fit: 'fill'` — there is no crop/"cover" mode. To get an exact square from a non-square source you must use `fill` (which stretches); otherwise `inside` keeps the aspect ratio and the output won't fill both dimensions.

`<Image>` also works inside `mochi:hydrate*` islands — forward the island's auto-injected `isHydratable` prop. Minting needs the server secret, so with the prop set the minted URL (and placeholder) are serialized into the page via Svelte's `hydratable` and reused during hydration — the browser never mints:

```svelte
<script lang="ts">
  import { Image } from 'mochi-framework/image';
  let { src, isHydratable }: { src: string; isHydratable?: boolean } = $props();
</script>

<Image {src} width={400} {isHydratable} />
```

If the forward is missing, or a client-side re-render changes the image props, there's no snapshot to reuse and the `<img>` degrades to the raw `src` URL.

<Callout type="warning">
Hydrated-island props ship in plain text in the page HTML — so a <code>src</code> you pass into a <code>mochi:hydrate</code> island (and any URL literal in the island's client JS) is visible to the client, even though the minted image URL itself stays encrypted. If your origin must stay secret, keep <code>&lt;Image&gt;</code> in server-rendered markup or a server island (<code>mochi:defer</code>), whose props are encrypted.
</Callout>

### Programmatic

`getResizedImage()` returns an encrypted URL — use it anywhere (no fetch happens until the browser requests it):

```ts
import { getResizedImage } from 'mochi-framework';

const url = getResizedImage('https://example.com/photo.jpg', {
  width: 500,
  height: 500,
  format: 'webp',
  quality: 80,
});
// → /_mochi/image/photo-500x500.webp?p=<encrypted token>
```

The returned URL is relative by default. To serve images from a CDN — or otherwise rewrite the host/prefix — register the [`image:url`](/docs/extensions/#imageurl) filter; it runs on the URL from both `getResizedImage()` and `getImage()` (and the `<Image>` component).

### Full-size originals

`getImage()` returns an encrypted URL for the **un-resized** original (original bytes and content-type), and `getImageBytes()` returns the cached bytes for server-side use:

```ts
import { getImage, getImageBytes } from 'mochi-framework';

const url = getImage('https://example.com/photo.jpg');
// → /_mochi/image/photo-original.jpg?p=<token>   — use in <img src>

const orig = await getImageBytes('https://example.com/photo.jpg');
// → { bytes, contentType } | null
```

The original is fetched once and **shared**: every resized variant of a source reads from this one cached download instead of re-fetching the origin per size/format. Originals aren't restricted to `outputFormats`, but the response is hardened against same-origin XSS: raster image types (`jpeg`, `png`, `webp`, `avif`, `gif`) are served inline with their original content-type, while `image/svg+xml` and any non-image type are served as a download (`Content-Type: application/octet-stream`, `Content-Disposition: attachment`) rather than rendered. All image responses also carry `X-Content-Type-Options: nosniff`.

The original's cache window comes from `timeToStale` / `timeToEvict`, overridable per call. Because many callers share one entry, the **shortest** requested window wins:

```ts
getImage(src, { timeToStale: 30_000, timeToEvict: 3_600_000 });
```

### Caching & TTL

The original's encoded bytes and its stale-while-revalidate timers are stored on disk (`cacheDir`), so the cache survives restarts. There is one TTL — the original's — and resized variants follow it; a variant never expires independently of the source it was resized from.

```ts
await Mochi.serve({
  image: {
    timeToStale: 14_400_000, // serve fresh for 4 h
    timeToEvict: 86_400_000, // re-fetch source after 1 day
  },
  routes,
});
```

- **Fresh** (within `timeToStale`): served from disk.
- **Stale** (between `timeToStale` and `timeToEvict`): served immediately, source re-fetched in the background.
- **Expired** (past `timeToEvict`): re-fetched synchronously.

When the original is re-fetched, any existing variants are served stale once more and regenerated from the new original in the background; when the original is evicted, its variants are dropped with it.

Eviction is lazy — dead bytes linger on disk until the next request overwrites them. A background janitor reclaims them: every `sweepIntervalMs` (default 1 h, plus once shortly after boot) it deletes evicted originals and orphaned/superseded variants, logging one `CACHE image:sweep` line per run. Set `sweepIntervalMs: 0` to disable it.

Served images carry both an `ETag` (tied to the cache generation) and a `Cache-Control` derived from the cache window — `public, max-age=<timeToStale>, stale-while-revalidate=<timeToEvict − timeToStale>`. Within `max-age` the browser serves from its own cache with no round-trip; after it, the `stale-while-revalidate` window lets it paint the cached copy instantly while revalidating in the background. The URL is stable per `(src, params)`, so once `max-age` lapses, correctness across a source refresh rides on the generation-aware `ETag`: a changed source yields a new `ETag` and the conditional request gets fresh bytes (a `304` while unchanged).

The trade-off of a non-zero `max-age` is that `invalidateImage()` only reaches an **already-cached browser** once its `max-age` expires — server-side revalidation still picks it up on the next miss. To tighten that, lower `timeToStale`: a smaller `max-age` revalidates sooner (and `timeToStale: 0` makes every request revalidate, falling back to background `stale-while-revalidate` so it stays a fast `304` rather than a blocking fetch).

In **development** mode no `Cache-Control` is sent at all, so edits and `invalidateImage()` calls always show up on the next request without a browser cache to fight.

### Invalidation

Invalidate a source immediately. It operates on the shared original, so it cascades to every resized variant — and to the ThumbHash placeholder, which is bound to the original's generation and recomputes once the source has been re-fetched:

```ts
import { invalidateImage } from 'mochi-framework';

await invalidateImage(src); // mark stale: next request serves cached bytes, re-fetches in the background
await invalidateImage(src, { hard: true }); // mark expired: next request blocks for a fresh re-fetch
```

### Custom pipelines with `cachedImage`

`getResizedImage` / `<Image>` cover resize + re-encode. For the full `Bun.Image` API — `rotate`, `flip`/`flop`, `modulate`, indexed-palette PNG, progressive JPEG, ThumbHash placeholders — use `cachedImage(src)`. It mirrors `Bun.Image`'s chainable API but caches each pipeline's output on the **same disk store** as `<Image>` (shared per-source originals, same stale-while-revalidate window and janitor). A cache hit skips the source fetch, decode, and encode:

```ts
import { cachedImage } from 'mochi-framework';

// Bytes / data URL of an arbitrary pipeline — cached by (src + chain).
const url = await cachedImage(src).resize(300, 300, { fit: 'inside' }).rotate(90).webp({ quality: 80 }).dataurl();

const bytes = await cachedImage(src).modulate({ saturation: 0 }).png().bytes();
const { width, height, format } = await cachedImage(src).resize(240, 240).metadata();
const blur = await cachedImage(src).placeholder(); // ThumbHash data URL (source-derived; ignores the chain)
```

Terminals: `bytes()`, `buffer()`, `blob()`, `toBase64()`, `dataurl()`, `metadata()`, `placeholder()`. `bytes()` and `dataurl()` for the same chain resolve to one on-disk variant. The cache key is the source URL plus the recorded op chain — if a source's bytes change under a stable URL, call `invalidateImage(src)` (it cascades to every `cachedImage` variant of that source too).

<Callout type="info">

**Server-only.** `cachedImage` reads/writes the disk cache and runs `Bun.Image`, so it only works server-side (in a page/API route or server island) — importing it into a hydratable island throws. `src` is fetched through the same SSRF-guarded pipeline as `<Image>`, so keep `blockPrivateNetworks` on and prefer `allowedHosts` for user-controlled sources.

</Callout>

### Configuration

Configure under `Mochi.serve({ image: { … } })`. Everything is optional:

```ts
await Mochi.serve({
  image: {
    cacheDir: './.mochi/image-cache',
    defaultFormat: 'webp',
    defaultQuality: 80,
    allowedHosts: ['cdn.example.com', '*.images.net'],
    maxResponseBytes: 20_000_000,
    fetchTimeoutMs: 10_000,
  },
  routes,
});
```

| Option                 | Default                | Notes                                                                     |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `enabled`              | `true`                 | `false` unmounts the endpoint; URL helpers then return the raw source URL |
| `cacheDir`             | `./.mochi/image-cache` | Must not be under `publicDir`                                             |
| `defaultFormat`        | `webp`                 | Used when the caller omits `format`                                       |
| `outputFormats`        | all four               | Allowed output formats                                                    |
| `allowedHosts`         | any public host        | Exact host or `*.example.com`                                             |
| `blockPrivateNetworks` | `true`                 | Reject private/loopback/link-local addresses                              |
| `fetchTimeoutMs`       | `10_000`               | Upstream fetch timeout                                                    |
| `maxResponseBytes`     | `20 MB`                | Hard source-size cap                                                      |
| `maxPixels`            | `50_000_000`           | Decompression-bomb guard                                                  |
| `timeToStale`          | `14_400_000`           | Cache time-to-stale (ms); variants follow it                              |
| `timeToEvict`          | `86_400_000`           | Cache time-to-evict (ms); variants follow it                              |
| `sweepIntervalMs`      | `3_600_000`            | Background cache-janitor interval; `0` disables                           |
| `compressPayload`      | `true`                 | Deflate the encrypted URL payload                                         |

<Callout type="warning">

**Encryption is the security boundary.** The payload is encrypted (authenticated encryption) with a key derived from your `MOCHI_KEY`, so only your server can mint URLs and the source URL/params stay hidden; the cosmetic filename is bound as authenticated data (tampering it fails decryption). Still, if you pass a **user-controlled** `src` into `getResizedImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user can't proxy requests to internal services. Upstream redirects are followed but **every hop is re-validated** against those same checks, so an allowed host can't `302` you into a private network; cap the hop count with the [`image:maxRedirects`](/docs/extensions/#imagemaxredirects) filter. SVG is never decoded for resizing, and a full-size original that is SVG (or any non-raster type) is served as a download rather than inline, so it can't execute script in your origin.

</Callout>

See the [Image Resizing demo](/demos/image/) for a working example.
