---
title: 'Images'
slug: images
description: 'On-the-fly image resizing on Bun.Image with signed URLs and a stale-while-revalidate disk cache.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Images

Mochi resizes images on the fly with [`Bun.Image`](https://bun.com/docs/runtime/image), serving them from an encrypted, stale-while-revalidate disk cache. Every URL's payload is AES-256-GCM encrypted, so the source URL and params aren't readable and an attacker can't request arbitrary sources through your server.

### Component

Import `Image` and point it at a source. It renders a single `<img>` with a signed, resized `src` — no client JS:

```svelte
<script>
  import { Image } from 'mochi-framework/components';
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
| `width` / `height`     | —          | Target size; height-only derives width by ratio                        |
| `alt`                  | `''`       | Always set this                                                        |
| `format`               | `webp`     | `webp` \| `jpeg` \| `png` \| `avif`                                    |
| `quality`              | `80`       | 1–100 (ignored for `png`)                                              |
| `fit`                  | `inside`   | `inside` keeps aspect & fits within W×H; `fill` stretches to exact W×H |
| `placeholder`          | `false`    | Blur-up via an inline `background-image`; pure SSR, no client JS       |
| `loading` / `decoding` | lazy/async | Passed through to `<img>`                                              |

> `Bun.Image` supports only `fit: 'inside'` and `fit: 'fill'` — there is no crop/"cover" mode. To get an exact square from a non-square source you must use `fill` (which stretches); otherwise `inside` keeps the aspect ratio and the output won't fill both dimensions.

### Programmatic

`getResizedImage()` returns a signed URL — use it anywhere (no fetch happens until the browser requests it):

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

### Full-size originals

`getImage()` returns a signed URL for the **un-resized** original (original bytes and content-type), and `getImageBytes()` returns the cached bytes for server-side use:

```ts
import { getImage, getImageBytes } from 'mochi-framework';

const url = getImage('https://example.com/photo.jpg');
// → /_mochi/image/photo-original.jpg?p=<token>   — use in <img src>

const orig = await getImageBytes('https://example.com/photo.jpg');
// → { bytes, contentType } | null
```

The original is fetched once and **shared**: every resized variant of a source reads from this one cached download instead of re-fetching the origin per size/format. Originals are served verbatim, so any format works (including `gif`) — they aren't restricted to `outputFormats`.

The original's cache window comes from `timeToStale` / `timeToEvict`, overridable per call. Because many callers share one entry, the **shortest** requested window wins:

```ts
getImage(src, { timeToStale: 30_000, timeToEvict: 3_600_000 });
```

### Caching & TTL

The original's encoded bytes and its stale-while-revalidate timers are stored on disk (`cacheDir`), so the cache survives restarts. There is one TTL — the original's — and resized variants follow it; a variant never expires independently of the source it was resized from.

```ts
await Mochi.serve({
  image: {
    timeToStale: 60_000, // serve fresh for 1 min
    timeToEvict: 86_400_000, // re-fetch source after 1 day
  },
  routes,
});
```

- **Fresh** (within `timeToStale`): served from disk.
- **Stale** (between `timeToStale` and `timeToEvict`): served immediately, source re-fetched in the background.
- **Expired** (past `timeToEvict`): re-fetched synchronously.

When the original is re-fetched, any existing variants are served stale once more and regenerated from the new original in the background; when the original is evicted, its variants are dropped with it.

Served images carry an `ETag` (tied to the cache generation) but **no** `Cache-Control` — browsers revalidate against the endpoint, getting a fast `304` while the content is unchanged and fresh bytes once it changes. That keeps the URL stable while letting `invalidateImage()` actually reach browsers on their next request.

### Invalidation

Invalidate a source immediately. It operates on the shared original, so it cascades to every resized variant:

```ts
import { invalidateImage } from 'mochi-framework';

await invalidateImage(src); // mark stale: next request serves cached bytes, re-fetches in the background
await invalidateImage(src, { hard: true }); // mark expired: next request blocks for a fresh re-fetch
```

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

| Option                 | Default                | Notes                                        |
| ---------------------- | ---------------------- | -------------------------------------------- |
| `enabled`              | `true`                 | Set `false` to unmount the endpoint          |
| `cacheDir`             | `./.mochi/image-cache` | Must not be under `publicDir`                |
| `defaultFormat`        | `webp`                 | Used when the caller omits `format`          |
| `outputFormats`        | all four               | Allowed output formats                       |
| `allowedHosts`         | any public host        | Exact host or `*.example.com`                |
| `blockPrivateNetworks` | `true`                 | Reject private/loopback/link-local addresses |
| `fetchTimeoutMs`       | `10_000`               | Upstream fetch timeout                       |
| `maxResponseBytes`     | `20 MB`                | Hard source-size cap                         |
| `maxPixels`            | `50_000_000`           | Decompression-bomb guard                     |
| `timeToStale`          | `60_000`               | Cache time-to-stale (ms); variants follow it |
| `timeToEvict`          | `86_400_000`           | Cache time-to-evict (ms); variants follow it |

<Callout type="warning">

**Encryption is the security boundary.** The payload is AES-256-GCM encrypted with a key derived from your `MOCHI_KEY`, so only your server can mint URLs and the source URL/params stay hidden; the cosmetic filename is bound as authenticated data (tampering it fails decryption). Still, if you pass a **user-controlled** `src` into `getResizedImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user can't proxy requests to internal services. Upstream redirects are followed but **every hop is re-validated** against those same checks, so an allowed host can't `302` you into a private network; cap the hop count with the [`image:maxRedirects`](/docs/extensions/#imagemaxredirects) filter. SVG is never decoded.

</Callout>

See the [Image Resizing demo](/demos/image/) for a working example.
