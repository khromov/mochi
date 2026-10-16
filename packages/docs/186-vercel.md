---
title: 'Mochi on Vercel'
slug: vercel
description: 'Deploy Mochi to Vercel as a container via Dockerfile.vercel — and the limitations of running a serverful framework on Fluid compute.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Mochi on Vercel

Vercel [builds and runs any `Dockerfile` on Fluid compute](https://vercel.com/blog/run-any-dockerfile-on-vercel) — add a `Dockerfile.vercel` and `vercel deploy` builds, stores, and autoscales the image. Mochi is a long-lived, [_serverful_](/docs/deployment-options/) Bun process, so it deploys as a container rather than through framework detection.

### Quick start

Add a `Dockerfile.vercel` (a copy of the [production Dockerfile](/docs/docker/) that listens on `$PORT`):

```dockerfile
# file: Dockerfile.vercel
FROM oven/bun:1.4-alpine
WORKDIR /app
COPY . .
RUN bun install --production
RUN bun run build
CMD ["bun", "run", "start"]
```

Then deploy:

```sh
vercel deploy
```

<Callout type="info">

`create-mochi` sets this up for you (create-mochi 0.4.0+) — the **"Are you planning to deploy to Vercel?"** prompt (or the `--vercel` flag) renames the scaffolded `Dockerfile` to `Dockerfile.vercel` and strips its baked-in `ENV PORT` so it honours Vercel's injected port.

</Callout>

### Listen on `$PORT`

Vercel injects `$PORT` at runtime (defaulting to `80`). The scaffolded `src/index.ts` already reads it:

```ts
const PORT = Number(process.env.PORT) || 3333;
```

so it works unchanged. Don't hardcode the port or bake `ENV PORT` into the image — a fixed value fights the port Vercel hands the container.

### Limitations

Mochi's built-in [SQLite](/docs/why-bun/), [in-memory cache](/docs/cache/), [queues](/docs/queues/), [WebSockets](/docs/websocket-routes/), and [SSE](/docs/server-sent-events/) assume a single, long-lived process with local disk. Vercel containers are **stateless and ephemeral** — instances autoscale up and down and hold nothing between requests — so those in-process features need external backing.

<Callout type="danger">

**No persistent filesystem.** SQLite files (`bun:sqlite`), queue persistence (`Mochi.queue({ dataPath })`), and the cache's `FileStorage` all write to local disk that does not survive a restart or scale event. Move durable state to a managed backend (a database or cache from the Vercel Marketplace, Postgres, Turso, …). Vercel notes durable storage attached to containers is coming.

</Callout>

<Callout type="warning">

**In-memory state is per-instance.** A default [`MochiCache`](/docs/cache/) (backed by a `Map`) and any in-memory queue live in one instance's memory. Fluid compute runs many instances and recycles them, so state isn't shared across them and is lost on scale-down. Point `MochiCache` at a shared `storage` backend (e.g. Redis) when correctness across instances matters.

</Callout>

<Callout type="warning">

**Background queues are unreliable.** The embedded [queue](/docs/queues/) processes jobs in-process only while an instance is alive, and jobs are in-memory unless persisted to disk (which doesn't survive here). Delayed, retried, or scheduled jobs can be dropped when instances recycle or scale to zero, and Fluid execution-time limits cap long-running `process` work. Use an external queue/worker for durable background jobs.

</Callout>

**WebSockets & SSE** work for short-lived streams, but long-lived connections are bounded by Fluid compute's request lifecycle and timeouts — for persistent realtime connections, run a dedicated server on a [serverful host](/docs/deployment-options/).

### See also

- [Building a Dockerfile](/docs/docker/) — the base production image.
- [Deployment options](/docs/deployment-options/) — serverful hosts where Mochi's built-ins run without caveats.
