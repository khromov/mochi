---
title: 'Images'
slug: images
description: 'On-the-fly image transforms on Bun.Image via named sizes, with encrypted URLs and a stale-while-revalidate disk cache.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import Callout from './_components/Callout.svelte';
  import placeholderShot from './images/image-placeholder.jpg';
</script>

## Images

Mochi transforms images on the fly with [`Bun.Image`](https://bun.com/docs/runtime/image), serving them from an encrypted, stale-while-revalidate disk cache. You declare transforms once as **named sizes** in `Mochi.serve()`, then reference them by name. `<Image>` and `getImageUrl()` only mint a signed URL — the fetch, decode, and transform happen lazily in the `/_mochi/image` endpoint on the browser's request, so **SSR never blocks on image work**. Every URL's payload is encrypted (authenticated encryption keyed off your `MOCHI_KEY`), so the source URL isn't readable and an attacker can't request arbitrary sources or transforms through your server.

### Declare sizes

Define your transforms under `Mochi.serve({ image: { sizes } })`. Each size is a named, declarative recipe:

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

Transforms apply in a fixed order: **resize → rotate → flip → flop → modulate → format-encode**. Sizes are validated at startup (bad dimensions/formats throw immediately). Redefining a size re-renders every URL that uses it — a config hash is folded into the cache key and `ETag`, so caches bust automatically.

| Size field           | Default             | Notes                                                              |
| -------------------- | ------------------- | ------------------------------------------------------------------ |
| `width` / `height`   | —                   | Target size; height-only derives width by ratio                    |
| `fit`                | `'inside'`          | `inside` keeps aspect & fits within W×H; `fill` stretches to W×H   |
| `withoutEnlargement` | `false`             | Never upscale beyond the source's intrinsic size                   |
| `rotate`             | none                | Degrees clockwise                                                  |
| `flip` / `flop`      | `false`             | Mirror vertically / horizontally                                   |
| `modulate`           | none                | `{ brightness?, saturation?, hue?, lightness? }` (`1` = unchanged) |
| `format`             | `defaultFormat`     | `webp` \| `jpeg` \| `png` \| `avif`                                |
| `quality`            | `defaultQuality`    | 1–100 (ignored for `png`)                                          |
| `autoOrient`         | global `autoOrient` | Apply EXIF orientation                                             |

> `Bun.Image` supports only `fit: 'inside'` and `fit: 'fill'` — there is no crop/"cover" mode. To get an exact square from a non-square source use `fill` (which stretches); otherwise `inside` keeps the aspect ratio and the output won't fill both dimensions.

### Component

Import `Image` and reference a size by name. It renders a single `<img>` with an encrypted `src` and no client JS. The `<img>`'s `width`/`height` default to the size's declared dimensions:

```svelte
<script>
  import { Image } from 'mochi-framework/image';
</script>

<Image src="https://example.com/photo.jpg" size="thumbnail" alt="A photo" />
```

Add `placeholder` to render a [ThumbHash](https://evanw.github.io/thumbhash/) blur behind the image. It's set as the `<img>`'s own `background-image` (no client JS), and the loaded image paints over it via a CSS blur-up (disabled under `prefers-reduced-motion`). The blur is computed **in the background** on first use — it never blocks SSR, so it appears from the second render onward:

```svelte
<Image src="https://example.com/photo.jpg" size="thumbnail" alt="A photo" placeholder />
```

<figure>
  <Image src={placeholderShot} size="doc" width={placeholderShot.width} height={placeholderShot.height} alt="Side by side: a soft colour-blurred rectangle on the left, and on the right the photo it resolves to — a mochi on a wooden board beside a pink lily" />
  <figcaption>The ThumbHash blur (left) and the image it resolves to (right). The hash is a handful of bytes, so the blur carries the photo's colour and composition without a second request.</figcaption>
</figure>

| Prop                   | Default     | Notes                                                                      |
| ---------------------- | ----------- | -------------------------------------------------------------------------- |
| `src`                  | —           | http/https URL, or a [local image import](#local-image-imports) (required) |
| `size`                 | —           | Named size; omitted → the full-size original                               |
| `alt`                  | `''`        | Always set this                                                            |
| `placeholder`          | `false`     | Background-warmed ThumbHash blur-up; pure SSR, no client JS                |
| `width` / `height`     | size's dims | `<img>` attribute override (for layout/CLS)                                |
| `loading` / `decoding` | lazy/async  | Passed through to `<img>`                                                  |

A bare `<Image src>` with no `size` serves the full-size original — that's the normal way to serve an un-resized image, not an error. An **unknown** size name also degrades to the original, but logs a one-time server warning.

`<Image>` also works inside `mochi:hydrate*` islands, at any nesting depth, with nothing to forward — it detects the hydrating subtree itself via [`isHydratable()`](/docs/selective-hydration/#ishydratable). Minting needs the server secret, so inside an island the minted URL is serialized into the page via Svelte's `hydratable` and reused during hydration — the browser never mints:

```svelte
<script lang="ts">
  import { Image } from 'mochi-framework/image';
  let { src }: { src: string } = $props();
</script>

<Image {src} size="thumbnail" />
```

If a client-side re-render changes the image props, there's no snapshot to reuse and the `<img>` degrades to the raw `src` URL.

<Callout type="warning">
Hydrated-island props ship in plain text in the page HTML — so a <code>src</code> you pass into a <code>mochi:hydrate</code> island (and any URL literal in the island's client JS) is visible to the client, even though the minted image URL itself stays encrypted. If your origin must stay secret, keep <code>&lt;Image&gt;</code> in server-rendered markup or a server island (<code>mochi:defer</code>), whose props are encrypted.
</Callout>

### Local image imports

Import a local image Vite-style and get back an object with its served URL and intrinsic metadata:

```svelte
<script>
  import { Image } from 'mochi-framework/image';
  import hero from './hero.png';
  // hero → { src: '/_mochi/asset/hero-<hash>.png', width, height, format }
</script>

<!-- Pass the object to <Image> — transforms and placeholder work as usual -->
<Image src={hero} size="thumbnail" alt="A resized local photo" />

<!-- Or use hero.src directly; width/height avoid layout shift -->
<img src={hero.src} width={hero.width} height={hero.height} alt="" />
```

Supported formats: **png, jpg, jpeg, webp, avif, gif**. SVG is not supported (it can't be decoded for metadata/transforms) — put SVGs in your `public/` directory and reference them with a plain `<img src>`.

The imported file is copied to a **content-hashed URL** (`/_mochi/asset/<slug>-<hash>.<ext>`) and served from disk with a long-lived immutable cache in production. Transforms read the file **from disk** — no network fetch — so `<Image src={hero} size="…">` and `placeholder` work without an origin round-trip. A bare `<Image src={hero}>` with no `size` renders the original at its intrinsic dimensions straight from that static URL (no endpoint hop). Emitted copies live under `<outDir>/assets/` and [relocate with the build](/docs/deployment-options/).

The `{ src, width, height, format }` shape is available as the exported `ImportedImage` type. Ambient module types for the image extensions come free via `mochi-framework/ambient` (already referenced by generated projects), so `import hero from './hero.png'` type-checks with no extra `global.d.ts`.

<Callout type="info">

A ThumbHash `placeholder` is still computed lazily on demand — nothing is precomputed at build time. It works on an imported image exactly as on a remote one (`<Image src={hero} placeholder>`, or `getImagePlaceholder(hero.src)`).

</Callout>

<Callout type="warning">
Two edge cases. With <code>image.enabled: false</code> the <code>/_mochi/asset/…</code> route still serves the file (it's plain static serving), but a <code>size</code> becomes a no-op — <code>&lt;Image&gt;</code> falls back to the raw static URL. And the <a href="/docs/extensions/#imageurl"><code>image:url</code></a> CDN-rewrite filter only runs on <em>minted</em> transform URLs, so the no-size static URL (<code>hero.src</code>) bypasses it — use a <code>size</code> if you need local assets routed through the filter.
</Callout>

### `getImageUrl` — deferred URLs

`getImageUrl(src, size)` returns an encrypted URL. It's synchronous and near-instant — no fetch happens until the browser requests it, and the transform runs in the endpoint:

```ts
import { getImageUrl } from 'mochi-framework';

const url = getImageUrl('https://example.com/photo.jpg', 'thumbnail');
// → /_mochi/image/photo-thumbnail.webp?p=<encrypted token>

const original = getImageUrl('https://example.com/photo.jpg');
// no size → a URL for the un-resized original
```

The returned URL is relative by default. To serve images from a CDN — or otherwise rewrite the host/prefix — register the [`image:url`](/docs/extensions/#imageurl) filter; it runs on the URL from `getImageUrl()`, `getImage()`, and the `<Image>` component.

### `getImageAttrs` — URL + declared dimensions

`getImageAttrs(src, size?)` is `getImageUrl` plus the size's declared `width`/`height` — what `<Image>` uses to set `src`/`width`/`height` in one server-side pass. Synchronous, server-only. With no `size` (or an unknown name) the dimensions are `undefined`:

```ts
import { getImageAttrs } from 'mochi-framework';

const { url, width, height } = getImageAttrs(src, 'thumbnail');
// → { url: '/_mochi/image/…', width: 200, height: 200 }
```

<Callout type="warning">

`getImageAttrs` and `<Image>` stamp the size's **declared** `width`/`height` as attributes — but with `fit: 'inside'` (the default) the served image's real dimensions can be smaller, since the transform fits within the box while keeping the aspect ratio. If the aspect ratio matters for layout, add CSS such as `height: auto` (or `object-fit`) so the declared attributes only reserve space instead of stretching the image.

</Callout>

### `getImage` — inline bytes + metadata

When you need the transformed bytes server-side (OG images, inlining, a dimension probe), `getImage(src, size)` runs the size **inline** and returns the bytes plus metadata. It shares the same disk cache as `getImageUrl`/`<Image>`, so a warm variant skips the fetch/decode/encode. Prefer `getImageUrl` for anything that ends up in an `<img src>` — it defers all work to the endpoint.

```ts
import { getImage } from 'mochi-framework';

const { bytes, contentType, width, height, format } = await getImage(src, 'thumbnail');

// No size → the cached full-size original bytes.
const original = await getImage(src);
```

An omitted size returns the cached original bytes; an unknown size name does the same, with a one-time server warning.

### Placeholder APIs

The ThumbHash blur behind `<Image placeholder>` is also available directly. All three are server-only and share the image cache:

```ts
import { getImagePlaceholder, imagePlaceholder, warmImagePlaceholder } from 'mochi-framework';

// Compute-and-cache: fetches/decodes the original on a miss (blocking).
// Returns a tiny data: URL, or null if the source can't be fetched/decoded.
const blur = await getImagePlaceholder(src);

// Non-blocking read: cached blur or null — a miss kicks off a background
// warm so a later render has it. This is what <Image placeholder> uses.
const maybeBlur = await imagePlaceholder(src);

// Fire-and-forget: start computing the blur now (de-duped while in flight),
// so a later render finds it cached.
warmImagePlaceholder(src);
```

Use `getImagePlaceholder` when you need the blur _now_ (e.g. an OG-image route) and can afford the fetch; use `imagePlaceholder`/`warmImagePlaceholder` in SSR paths that must never block on image work.

### Full-size originals

The original is fetched once and **shared**: every variant of a source reads from this one cached download instead of re-fetching the origin per size. Originals aren't restricted to `outputFormats`, but the response is hardened against same-origin XSS: raster image types (`jpeg`, `png`, `webp`, `avif`, `gif`) are served inline with their original content-type, while `image/svg+xml` and any non-image type are served as a download (`Content-Type: application/octet-stream`, `Content-Disposition: attachment`) rather than rendered. All image responses also carry `X-Content-Type-Options: nosniff`.

### Caching & TTL

The original's encoded bytes and its stale-while-revalidate timers are stored on disk (`cacheDir`), so the cache survives restarts. There is one TTL — the original's — and variants follow it; a variant never expires independently of the source it was transformed from. Both TTLs are global only; sizes have no TTL overrides:

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

A variant has no window of its own — its freshness mirrors the shared original at request time: while the original is fresh the variant serves from disk; once the original goes stale the variant is served stale and regenerated in the background; once it expires the variant is regenerated synchronously.

Eviction is lazy — entries past the cache window linger on disk until reclaimed. A background janitor reclaims them by age: every `sweepIntervalMs` (default 1 h, plus once shortly after boot) it deletes entries past `timeToEvict`, logging one `CACHE image:sweep` line per run. A hard `invalidateImage()` additionally drops a source's variants and placeholder right away. Set `sweepIntervalMs: 0` to disable the janitor.

Served images carry both an `ETag` (tied to the cache generation and the size config hash) and a `Cache-Control` derived from the cache window — `public, max-age=<timeToStale>, stale-while-revalidate=<timeToEvict − timeToStale>`. Within `max-age` the browser serves from its own cache with no round-trip; after it, the `stale-while-revalidate` window lets it paint the cached copy instantly while revalidating in the background. The URL is stable per `(src, size)`, so once `max-age` lapses, correctness across a source refresh or a size redefinition rides on the `ETag`.

The trade-off of a non-zero `max-age` is that `invalidateImage()` only reaches an **already-cached browser** once its `max-age` expires — server-side revalidation still picks it up on the next miss. To tighten that, lower `timeToStale`. In **development** mode no `Cache-Control` is sent at all, so edits and `invalidateImage()` calls always show up on the next request.

### Custom cache storage

By default the image cache is backed by `FileStorage` under `cacheDir`, so it survives restarts. Pass `storage` to swap in a different backend — e.g. `MemoryStorage` for a faster, disk-free cache:

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

`cacheDir` is ignored once `storage` is set. `maxAge` drives the same background janitor (`sweepIntervalMs`) that would otherwise sweep `FileStorage` — omit it and entries are never reclaimed.

<Callout type="warning">

**In-memory image caching trades disk for RAM.** Every cached original and resized variant's bytes live in process memory instead of on disk, so cache size adds directly to your process's memory footprint — size `maxAge`/`timeToEvict` accordingly for your traffic. The cache is also lost on every restart or deploy, so the first request after a restart always re-fetches and re-transforms.

</Callout>

### Invalidation

Invalidate a source immediately. It operates on the shared original, so it cascades to every variant — and to the ThumbHash placeholder:

```ts
import { invalidateImage } from 'mochi-framework';

await invalidateImage(src); // mark stale: next request serves cached bytes, re-fetches in the background
await invalidateImage(src, { hard: true }); // mark expired: next request blocks for a fresh re-fetch
```

In dev, each image produced during a request shows up in the [debug bar's Images panel](/docs/debug-bar/#images-panel) — deferred `getImageUrl`/`<Image>` URLs and inline `getImage()` results, tagged with the size name.

### Configuration

Configure under `Mochi.serve({ image: { … } })`. Every option is optional — `sizes` defaults to `{}`:

| Option                 | Default                 | Notes                                                                          |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `sizes`                | `{}`                    | Named transform recipes (see [Declare sizes](#declare-sizes))                  |
| `enabled`              | `true`                  | `false` unmounts the endpoint; URL helpers then return the raw source URL      |
| `cacheDir`             | `./.mochi/image-cache`  | Must not be under `publicDir`; ignored when `storage` is set                   |
| `storage`              | `FileStorage(cacheDir)` | Override the cache backend (see [Custom cache storage](#custom-cache-storage)) |
| `defaultFormat`        | `webp`                  | Used when a size omits `format`                                                |
| `defaultQuality`       | `80`                    | Used when a size omits `quality`                                               |
| `outputFormats`        | all four                | Allowed output formats                                                         |
| `allowedHosts`         | any public host         | Exact host or `*.example.com`                                                  |
| `blockPrivateNetworks` | `true`                  | Reject private/loopback/link-local addresses                                   |
| `fetchTimeoutMs`       | `10_000`                | Upstream fetch timeout                                                         |
| `maxResponseBytes`     | `20 MB`                 | Hard source-size cap                                                           |
| `maxPixels`            | `50_000_000`            | Decompression-bomb guard                                                       |
| `timeToStale`          | `14_400_000`            | Cache time-to-stale (ms); variants follow it                                   |
| `timeToEvict`          | `86_400_000`            | Cache time-to-evict (ms); variants follow it                                   |
| `sweepIntervalMs`      | `3_600_000`             | Background cache-janitor interval; `0` disables                                |
| `compressPayload`      | `true`                  | Deflate the encrypted URL payload                                              |

<Callout type="warning">

**Encryption is the security boundary.** The payload is encrypted (authenticated encryption) with a key derived from your `MOCHI_KEY`, so only your server can mint URLs and the source URL stays hidden; the cosmetic filename is bound as authenticated data (tampering it fails decryption). Callers can only reference sizes the server declared. Still, if you pass a **user-controlled** `src` into `getImageUrl()`/`getImage()`, keep `blockPrivateNetworks` on (the default) and prefer an `allowedHosts` allowlist so a user can't proxy requests to internal services. Upstream redirects are followed but **every hop is re-validated** against those same checks, so an allowed host can't `302` you into a private network; cap the hop count with the [`image:maxRedirects`](/docs/extensions/#imagemaxredirects) filter. SVG is never decoded for transforms, and a full-size original that is SVG (or any non-raster type) is served as a download rather than inline, so it can't execute script in your origin.

</Callout>

See the [Named sizes demo](/demos/image-pipeline/) and the [Image demo](/demos/image/) for working examples.
