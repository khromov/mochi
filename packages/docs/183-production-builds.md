---
title: 'Production builds'
slug: production-builds
description: 'How a Mochi build behaves in production: relocatable output and a persistent image cache.'
---

<script>
import Callout from './_components/Callout.svelte';
import VersionNote from './_components/VersionNote.svelte';
</script>

# Production builds

`mochi-framework build` writes a self-contained build to `.mochi/` (see the [CLI reference](/docs/cli/)). This page covers what that build gives you once it is deployed: it relocates cleanly from where you built it to where you run it, and its image cache can survive container restarts. For where to run it, see [Deployment options](/docs/deployment-options/); to containerize it, see [Building a Dockerfile](/docs/docker/).

## Relocatable builds

A manifest holds no absolute paths — artifacts are written relative to the out-dir, sources relative to the project root — so you can build in one place and run in another. Build in a CI stage, copy `.mochi/` into the final image, and point the runtime at wherever it landed:

```ts
Mochi.serve({ outDir: './.mochi' }); // default — or wherever you copied it
```

Paths resolve against the manifest's own directory, so pointing `manifest` at a relocated build works on its own:

```ts
Mochi.serve({ manifest: '/srv/app/build/manifest.json' });
```

<Callout type="warning">

Five things still anchor a prebuilt app to its project:

- **Build and serve from the same working directory.** Components are keyed relative to the project root, which both `mochi-framework build` and `Mochi.serve()` take to be the current working directory. Run both from the project root.
- **Ship your `public/` directory.** Static files are never copied into the build. The runtime scans `publicDir` (default `./public`) at startup in production exactly as in development. A deploy that ships only `.mochi/` and `src/` 404s every static file.
- **Keep the out-dir in the project tree.** The compiled SSR modules resolve `node_modules` from the out-dir's location.
- **On-demand server islands need sources.** Islands missing from the manifest are compiled at request time from source paths recorded at build. Prebuilt islands relocate fine.
- **Keep email templates in `src/emails/`.** A `Mochi.email({ component })` template is reachable only at send time, so the build walks that directory to find it. See [Svelte templates](/docs/email/#svelte-templates).

</Callout>

<Callout type="danger">

The manifest records a schema version, and the runtime loads only the exact version it writes. Booting a build made by a different `mochi-framework` version throws at startup. Always run `mochi-framework build` with the same version you serve with.

</Callout>

## Persistent image cache

Mochi's [image cache](/docs/images/) is written to disk under `cacheDir` (default `./.mochi/image-cache`). In a container that directory is recreated on every restart, so each redeploy starts with a cold cache and re-fetches and re-transforms every image. To keep the transformed bytes across restarts, point `cacheDir` at a dedicated path and mount a volume there:

```ts
Mochi.serve({
  image: { cacheDir: process.env.MOCHI_IMAGE_CACHE_DIR /* , sizes: … */ },
});
```

```yaml
services:
  site:
    image: your-app
    environment:
      MOCHI_IMAGE_CACHE_DIR: /data/image-cache
    volumes:
      - image-cache:/data/image-cache

volumes:
  image-cache:
```

A plain `docker run -v image-cache:/data/image-cache your-app` mounts the same volume. Keep the mount off `./.mochi` — its build cache is rebuilt on every boot and must not persist. If the container runs as a non-root user, pre-create the directory owned by that user in your `Dockerfile` so the mounted volume is writable.

<Callout type="info">

Keep `MOCHI_KEY` stable across restarts. Image URLs are signed with a key derived from it, so a changed key invalidates already-minted links even though the cached bytes are still on disk.

</Callout>

## JavaScript minifier

<VersionNote since="0.10.0" message="The minifier option was added in 0.10.0. Earlier versions always use Bun's minifier." />

Client JavaScript is minified by Bun's bundler. Set `minifier: 'oxc'` to run a second [oxc](https://oxc.rs/docs/guide/usage/minifier) pass over the chunks Bun emitted, which takes roughly another **3–4%** off the bundle:

```sh
bun add -d oxc-minify
```

```ts
// src/index.ts
await Mochi.serve({
  minifier: 'oxc',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
  },
});
```

`mochi-framework build` reads the option from your entry. Override it per build with `--minifier <bun|oxc>`:

```sh
mochi-framework build --minifier oxc
```

The pass covers the hydration bundle and the inline web-component scripts. CSS, static assets and the SSR build are untouched. Bun's own minifier keeps running first — it mangles identifiers across the whole split graph, which oxc cannot redo one chunk at a time — so oxc is purely additive.

<Callout type="warning">

Chunk file names are content-hashed from Bun's output, before oxc runs. Switching `minifier` therefore changes a chunk's bytes without changing its name. Purge your CDN cache when you switch.

</Callout>

<Callout type="info">

`oxc-minify` is an optional peer dependency. With `minifier: 'oxc'` set and the package missing, the build fails with install instructions rather than quietly falling back, so deployed bundle sizes always match the mode you asked for.

</Callout>
