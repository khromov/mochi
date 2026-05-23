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

### `--production` and devDeps

`bun install --production` omits everything under `devDependencies`. Keep `mochi-framework` and `svelte` in `dependencies`; move `svelte-check`, `typescript`, and build-time scripts to `devDependencies`.

<Callout type="info">

`bun run start` runs your `start` script (typically `bun src/index.ts`). The port your app listens on is the one passed to `Mochi.serve({ port })`. Match it with `EXPOSE` and `-p` so the container's port is reachable from the host.

</Callout>
