---
title: 'Building a Dockerfile'
slug: docker
description: 'A minimal production Dockerfile template for deploying Mochi apps with Bun.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Building a Dockerfile

A production Mochi app is a single Bun process. This image is a one-stage build on `oven/bun:1.4-alpine`.

### Minimal Dockerfile

```dockerfile
# file: Dockerfile
FROM oven/bun:1.4-alpine
WORKDIR /app
COPY . .
RUN bun install --production
RUN bun run build
EXPOSE 3333
CMD ["bun", "run", "start"]
```

Build and run:

```sh
docker build -t my-app .
docker run --rm -p 3333:3333 my-app
```

<Callout type="info">

`bun run build` and `bun run start` must share a working directory. The template's single `WORKDIR /app` covers it. Watch a multi-stage build that copies `.mochi/` into a differently-shaped final image: keep the app at the same path in both stages, and copy `public/` across too — static files are read from that directory at runtime, never from `.mochi/`.

</Callout>

A one-route app lands at about 160 MB. About 87 MB is the Bun binary. The floor for any Bun-based image is around 105 MB.

### `.dockerignore`

Exclude artifacts and local state from the build context. They are regenerated inside the image:

```
# file: .dockerignore
node_modules
.mochi
.git
.env*
```

Do not add `public` to that list. Unlike `.mochi`, it is not regenerated inside the image — the runtime reads it from disk on every boot. If it does not make it in, the server warns at startup:

```
[mochi] publicDir "public" is missing or empty, but the build found 12 file(s) there —
every static file will 404.
```

### `--production` and devDeps

`bun install --production` omits everything under `devDependencies`. Keep `mochi-framework` and `svelte` in `dependencies`. Move `svelte-check`, `typescript`, and build-time scripts to `devDependencies`.

<Callout type="info">

`bun run start` runs your `start` script (typically `bun src/index.ts`). The port your app listens on is the one passed to `Mochi.serve({ port })`. Match it with `EXPOSE` and `-p`.

</Callout>
