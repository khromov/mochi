---
title: 'Images'
slug: images
description: 'On-the-fly image resizing on Bun.Image with signed URLs and a stale-while-revalidate disk cache.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Images

Mochi resizes images on the fly with [`Bun.Image`](https://bun.com/docs/runtime/image), serving them from a signed, stale-while-revalidate disk cache. Every URL is HMAC-signed, so an attacker can't request arbitrary sources through your server.

### Component

Import `Image` and point it at a source. It renders a single `<img>` with a signed, resized `src` — no client JS:

```svelte
<script>
  import { Image } from 'mochi-framework/components';
</script>

<Image src="https://example.com/photo.jpg" width={640} height={400} alt="A photo" />
```

Add `placeholder` to render a [ThumbHash](https://evanw.github.io/thumbhash/) blur that fades out once the image loads:

```svelte
<Image src="https://example.com/photo.jpg" width={640} height={400} alt="A photo" placeholder />
```

| Prop                   | Default    | Notes                                           |
| ---------------------- | ---------- | ----------------------------------------------- |
| `src`                  | —          | http/https source URL (required)                |
| `width` / `height`     | —          | Target size; height-only derives width by ratio |
| `alt`                  | `''`       | Always set this                                 |
| `format`               | `webp`     | `webp` \| `jpeg` \| `png` \| `avif`             |
| `quality`              | `80`       | 1–100 (ignored for `png`)                       |
| `fit`                  | `inside`   | `inside` \| `fill`                              |
| `placeholder`          | `false`    | Blur-up via a tiny hydrated island              |
| `loading` / `decoding` | lazy/async | Passed through to `<img>`                       |

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
// → /_mochi/image/<token>.webp?sig=<sig>
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

**The signature is the security boundary.** Because URLs are HMAC-signed with your `MOCHI_KEY`, only your server can mint them. Still, if you pass a **user-controlled** `src` into `getResizedImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user can't proxy requests to internal services. SVG is never decoded.

</Callout>

See the [Image Resizing demo](/demos/image/) for a worked example.
