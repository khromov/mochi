---
title: 'Images'
slug: images
ogTitle: 'On-the-fly image transforms'
description: 'On-the-fly image transforms on Bun.Image via named sizes, with encrypted URLs and a stale-while-revalidate disk cache.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import Callout from './_components/Callout.svelte';
  import placeholderShot from './images/image-placeholder.jpg';
</script>

## Images

Mochi transforms images on the fly with [`Bun.Image`](https://bun.com/docs/runtime/image) and serves them from an encrypted, stale-while-revalidate disk cache. Declare transforms once as **named sizes** in `Mochi.serve()`, then reference them by name. `<Image>` and `getImageUrl()` mint a signed URL only. The fetch, decode, and transform happen lazily in the `/_mochi/image` endpoint on the browser's request, so **SSR never blocks on image work**. Every URL payload is encrypted with a key derived from your `MOCHI_KEY`, so the source URL stays hidden and an attacker cannot request arbitrary sources or transforms.

### Declare sizes

Define transforms under `Mochi.serve({ image: { sizes } })`. Each size is a named recipe:

```ts
await Mochi.serve({
  image: {
    sizes: {
      thumbnail: { width: 200, height: 200, fit: 'inside', format: 'webp', quality: 80 },
      avatar: { width: 96, height: 96, fit: 'fill' },
      grayscale: { width: 600, modulate: { saturation: 0 }, format: 'jpeg', quality: 85 },
    },
  },
  routes,
});
```

Transforms apply in a fixed order: resize → rotate → flip → flop → modulate → format-encode. Mochi validates sizes at startup. Redefining a size re-renders every URL that uses it, since a config hash is folded into the cache key and `ETag`.

| Size field           | Default             | Notes                                                              |
| -------------------- | ------------------- | ------------------------------------------------------------------ |
| `width` / `height`   | —                   | Target size; height-only derives width by ratio                    |
| `fit`                | `'inside'`          | `inside` keeps aspect and fits within W×H; `fill` stretches to W×H |
| `withoutEnlargement` | `false`             | Never upscale beyond the source's intrinsic size                   |
| `rotate`             | none                | Degrees clockwise                                                  |
| `flip` / `flop`      | `false`             | Mirror vertically / horizontally                                   |
| `modulate`           | none                | `{ brightness?, saturation?, hue?, lightness? }` (`1` = unchanged) |
| `format`             | `defaultFormat`     | `webp` \| `jpeg` \| `png` \| `avif`                                |
| `quality`            | `defaultQuality`    | 1–100 (ignored for `png`)                                          |
| `autoOrient`         | global `autoOrient` | Apply EXIF orientation                                             |

> `Bun.Image` supports `fit: 'inside'` and `fit: 'fill'` only. For an exact square from a non-square source use `fill` (which stretches). Otherwise `inside` keeps the aspect ratio.

### Component

Import `Image` and reference a size by name. It renders one `<img>` with an encrypted `src` and no client JavaScript. The `<img>` `width`/`height` default to the size's declared dimensions.

```svelte
<script>
  import { Image } from 'mochi-framework/image';
</script>

<Image src="https://example.com/photo.jpg" size="thumbnail" alt="A photo" />
```

Add `placeholder` to render a [ThumbHash](https://evanw.github.io/thumbhash/) blur behind the image. It is set as the `<img>` `background-image` (no client JavaScript), and the loaded image paints over it with a CSS blur-up. The blur is computed in the background on first use, so it appears from the second render onward.

```svelte
<Image src="https://example.com/photo.jpg" size="thumbnail" alt="A photo" placeholder />
```

<figure>
  <Image src={placeholderShot} size="doc" width={placeholderShot.width} height={placeholderShot.height} alt="Side by side: a soft colour-blurred rectangle on the left, and on the right the photo it resolves to — a mochi on a wooden board beside a pink lily" />
  <figcaption>The ThumbHash blur (left) and the image it resolves to (right).</figcaption>
</figure>

| Prop                   | Default     | Notes                                                                      |
| ---------------------- | ----------- | -------------------------------------------------------------------------- |
| `src`                  | —           | http/https URL, or a [local image import](#local-image-imports) (required) |
| `size`                 | —           | Named size; omitted → the full-size original                               |
| `alt`                  | `''`        | Always set this                                                            |
| `placeholder`          | `false`     | Background-warmed ThumbHash blur-up; pure SSR, no client JavaScript        |
| `width` / `height`     | size's dims | `<img>` attribute override                                                 |
| `loading` / `decoding` | lazy/async  | Passed through to `<img>`                                                  |

A bare `<Image src>` with no `size` serves the full-size original. An unknown size name degrades to the original and logs a one-time server warning.

`<Image>` works inside `mochi:hydrate*` islands at any depth — it detects the hydrating subtree with [`isHydratable()`](/docs/selective-hydration/#ishydratable). Minting needs the server secret, so inside an island the minted URL is serialized into the page via Svelte's `hydratable` and reused during hydration. If a client-side re-render changes the image props, there is no snapshot to reuse and the `<img>` degrades to the raw `src` URL.

<Callout type="warning">

Hydrated-island props ship in plain text in the page HTML, so a `src` you pass into a `mochi:hydrate` island is visible to the client, even though the minted image URL stays encrypted. If your origin must stay secret, keep `<Image>` in server-rendered markup or a server island (`mochi:defer`), whose props are encrypted.

</Callout>

### Local image imports

Import a local image Vite-style and get an object with its served URL and intrinsic metadata:

```svelte
<script>
  import { Image } from 'mochi-framework/image';
  import hero from './hero.png';
  // hero → { src: '/_mochi/asset/hero-<hash>.png', width, height, format }
</script>

<Image src={hero} size="thumbnail" alt="A resized local photo" />
<img src={hero.src} width={hero.width} height={hero.height} alt="" />
```

Supported formats: png, jpg, jpeg, webp, avif, gif. Put SVGs in your `public/` directory and reference them with a plain `<img src>`.

Mochi copies the file to a content-hashed URL (`/_mochi/asset/<slug>-<hash>.<ext>`) and serves it from disk with a long-lived immutable cache in production. Transforms read the file from disk, so `<Image src={hero} size="…">` and `placeholder` work without an origin round-trip. Emitted copies live under `<outDir>/assets/` and [relocate with the build](/docs/deployment-options/#relocatable-builds).

The `{ src, width, height, format }` shape is available as the exported `ImportedImage` type. Ambient module types come free through `mochi-framework/ambient`.

A bare `<Image src={hero}>` with no `size` renders the original at its intrinsic dimensions straight from that static URL. It never calls the image endpoint.

<Callout type="warning">

Two edge cases. With `image.enabled: false` the `/_mochi/asset/…` route still serves the file, because that route is plain static serving and registers independently of the flag. The transform does not run: `<Image>` falls back to the raw static URL, while the `<img>` keeps the size's declared `width`/`height`, so the browser scales the full-size original into that box. And the [`image:url`](/docs/extensions/#imageurl) CDN-rewrite filter runs on minted transform URLs only, so the no-size static URL (`hero.src`) bypasses it. Use a `size` if you need local assets routed through the filter.

</Callout>

### `getImageUrl` — deferred URLs

`getImageUrl(src, size)` returns an encrypted URL. It is synchronous and near-instant. No fetch happens until the browser requests it.

```ts
import { getImageUrl } from 'mochi-framework';

const url = getImageUrl('https://example.com/photo.jpg', 'thumbnail');
// → /_mochi/image/photo-thumbnail.webp?p=<encrypted token>

const original = getImageUrl('https://example.com/photo.jpg'); // no size → the original
```

The URL is relative by default. To serve images from a CDN, register the [`image:url`](/docs/extensions/#imageurl) filter.

### `getImageAttrs` — URL + declared dimensions

`getImageAttrs(src, size?)` returns `getImageUrl` plus the size's declared `width`/`height`. Synchronous, server-only.

```ts
import { getImageAttrs } from 'mochi-framework';

const { url, width, height } = getImageAttrs(src, 'thumbnail');
// → { url: '/_mochi/image/…', width: 200, height: 200 }
```

<Callout type="warning">

With `fit: 'inside'` (the default), the served image's real dimensions can be smaller than the declared ones. If the aspect ratio matters for layout, add CSS such as `height: auto` so the declared attributes only reserve space.

</Callout>

### `getImage` — inline bytes + metadata

When you need the transformed bytes server-side (OG images, inlining, a dimension probe), `getImage(src, size)` runs the size inline and returns bytes plus metadata. It shares the same disk cache. Prefer `getImageUrl` for anything that ends up in an `<img src>`.

```ts
import { getImage } from 'mochi-framework';

const { bytes, contentType, width, height, format } = await getImage(src, 'thumbnail');
const original = await getImage(src); // no size → the cached original bytes
```

### Placeholder APIs

The ThumbHash blur is also available directly. All three are server-only and share the image cache:

```ts
import { getImagePlaceholder, imagePlaceholder, warmImagePlaceholder } from 'mochi-framework';

const blur = await getImagePlaceholder(src); // compute-and-cache, blocking; data: URL or null
const maybeBlur = await imagePlaceholder(src); // non-blocking read; cached blur or null
warmImagePlaceholder(src); // fire-and-forget compute
```

### Caching & TTL

Mochi stores the original's encoded bytes and its stale-while-revalidate timers on disk (`cacheDir`), so the cache survives restarts. There is one TTL — the original's — and variants follow it:

```ts
await Mochi.serve({
  image: {
    timeToStale: 14_400_000, // serve fresh for 4h
    timeToEvict: 86_400_000, // re-fetch source after 1 day
  },
  routes,
});
```

- **Fresh** (within `timeToStale`): served from disk.
- **Stale** (between `timeToStale` and `timeToEvict`): served immediately, source re-fetched in the background.
- **Expired** (past `timeToEvict`): re-fetched synchronously.

A background janitor reclaims entries past `timeToEvict` every `sweepIntervalMs` (default 1h). Set `sweepIntervalMs: 0` to disable it.

Served images carry an `ETag` and a `Cache-Control` derived from the cache window (`public, max-age=<timeToStale>, stale-while-revalidate=<timeToEvict − timeToStale>`). In development no `Cache-Control` is sent, so edits and `invalidateImage()` calls always show up on the next request.

### Custom cache storage

Mochi backs the image cache with `FileStorage` under `cacheDir` by default. Pass `storage` to swap in a different backend, for example `MemoryStorage`.

```ts
import { MemoryStorage } from 'mochi-framework';

await Mochi.serve({
  image: {
    storage: new MemoryStorage({ maxAge: 86_400_000 }), // must be >= timeToEvict
    timeToStale: 14_400_000,
    timeToEvict: 86_400_000,
    sizes: { thumbnail: { width: 200, height: 200 } },
  },
  routes,
});
```

<Callout type="warning">

**In-memory image caching trades disk for RAM.** Every cached original and variant lives in process memory, so cache size adds to your process's memory footprint. The cache is lost on every restart, so the first request after a restart re-fetches and re-transforms.

</Callout>

### Invalidation

```ts
import { invalidateImage } from 'mochi-framework';

await invalidateImage(src); // mark stale: next request serves cached bytes, re-fetches in background
await invalidateImage(src, { hard: true }); // mark expired: next request blocks for a fresh re-fetch
```

`invalidateImage()` operates on the shared original, so it cascades to every variant and the ThumbHash placeholder.

### Configuration

Configure under `Mochi.serve({ image: { … } })`. Every option is optional.

| Option                 | Default                 | Notes                                                                     |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `sizes`                | `{}`                    | Named transform recipes                                                   |
| `enabled`              | `true`                  | `false` unmounts the endpoint; URL helpers then return the raw source URL |
| `cacheDir`             | `./.mochi/image-cache`  | Must not be under `publicDir`; ignored when `storage` is set              |
| `storage`              | `FileStorage(cacheDir)` | Override the cache backend                                                |
| `defaultFormat`        | `webp`                  | Used when a size omits `format`                                           |
| `defaultQuality`       | `80`                    | Used when a size omits `quality`                                          |
| `outputFormats`        | all four                | Allowed output formats                                                    |
| `allowedHosts`         | any public host         | Exact host or `*.example.com`                                             |
| `blockPrivateNetworks` | `true`                  | Reject private/loopback/link-local addresses                              |
| `fetchTimeoutMs`       | `10_000`                | Upstream fetch timeout                                                    |
| `maxResponseBytes`     | `20 MB`                 | Hard source-size cap                                                      |
| `maxPixels`            | `50_000_000`            | Decompression-bomb guard                                                  |
| `timeToStale`          | `14_400_000`            | Cache time-to-stale (ms); variants follow it                              |
| `timeToEvict`          | `86_400_000`            | Cache time-to-evict (ms); variants follow it                              |
| `sweepIntervalMs`      | `3_600_000`             | Background cache-janitor interval; `0` disables                           |
| `compressPayload`      | `true`                  | Deflate the encrypted URL payload                                         |

<Callout type="danger">

**Encryption is the security boundary.** The payload is encrypted with a key derived from your `MOCHI_KEY`, so only your server can mint URLs and the source URL stays hidden. If you pass a **user-controlled** `src` into `getImageUrl()`/`getImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user cannot proxy requests to internal services. Upstream redirects are followed, but every hop is re-validated against those same checks. Cap the hop count with the [`image:maxRedirects`](/docs/extensions/#imagemaxredirects) filter. A full-size original that is SVG (or any non-raster type) is served as a download rather than inline.

</Callout>

See the [Named sizes demo](/demos/image-pipeline/) and the [Image demo](/demos/image/).
