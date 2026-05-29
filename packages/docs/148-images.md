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
// → /_mochi/image/photo-500x500.webp?payload=<encrypted token>
```

### Caching & TTL

Resized bytes and their stale-while-revalidate timers are stored on disk (`cacheDir`), so the cache survives restarts. Pass per-image TTLs:

```ts
getResizedImage(src, {
  width: 800,
  timeToStale: 60_000, // serve fresh for 1 min
  timeToEvict: 86_400_000, // re-fetch source after 1 day
});
```

- **Fresh** (within `timeToStale`): served from disk.
- **Stale** (between `timeToStale` and `timeToEvict`): served immediately, source re-fetched in the background.
- **Expired** (past `timeToEvict`): re-fetched synchronously.

### Invalidation

```ts
import { invalidateImage } from 'mochi-framework';

await invalidateImage(src); // every variant + placeholder of this source
await invalidateImage(src, { width: 500, height: 500 }); // just that variant
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

<Callout type="danger">

**Encryption is the security boundary.** The payload is AES-256-GCM encrypted with a key derived from your `MOCHI_KEY`, so only your server can mint URLs and the source URL/params stay hidden; the cosmetic filename is bound as authenticated data (tampering it fails decryption). Still, if you pass a **user-controlled** `src` into `getResizedImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user can't proxy requests to internal services. SVG is never decoded.

</Callout>

See the [Image Resizing demo](/demos/image/) for a worked example.
