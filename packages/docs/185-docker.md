---
title: 'Building a Dockerfile'
slug: docker
description: 'A minimal production Dockerfile template for deploying Mochi apps with Bun.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Building a Dockerfile

A production Mochi app is a single Bun process. This example image is a simple one-stage build on `oven/bun:1.3-alpine` — no Node, no preprocessor, no shell at runtime.

### Minimal Dockerfile

```dockerfile
# file: Dockerfile
FROM oven/bun:1.3-alpine
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

`bun run build` and `bun run start` must share a working directory — the template's single `WORKDIR /app` covers it. The one to watch is a multi-stage build that copies `.mochi/` into a differently-shaped final image: keep the app at the same path in both stages, and copy `public/` across too — static files are read from that directory at runtime, never from `.mochi/`. The framework's own components are exempt, so `mochi-framework` moving between a workspace checkout and `node_modules/` across stages is fine.

</Callout>

A one-route app lands at ~160 MB. ~87 MB of that is the Bun binary itself — the floor for any Bun-based image is around ~105 MB.

### `.dockerignore`

Exclude artifacts and local state from the build context — they're regenerated inside the image and just inflate the upload:

```
# file: .dockerignore
node_modules
.mochi
.git
.env*
```

Don't add `public` to that list. Unlike `.mochi`, it isn't regenerated inside the image — the runtime reads it from disk on every boot.

### `--production` and devDeps

`bun install --production` omits everything under `devDependencies`. Keep `mochi-framework` and `svelte` in `dependencies`; move `svelte-check`, `typescript`, and build-time scripts to `devDependencies`.

<Callout type="info">

`bun run start` runs your `start` script (typically `bun src/index.ts`). The port your app listens on is the one passed to `Mochi.serve({ port })`. Match it with `EXPOSE` and `-p` so the container's port is reachable from the host.

</Callout>
