---
title: 'Deployment options'
slug: deployment-options
description: 'Where to deploy your Mochi app: PaaS, VPS, big cloud, and self-hosted options.'
---

<script>
import Callout from './_components/Callout.svelte';
</script>

# Deployment options

Mochi is a **serverful** application, so it does not run on every serverless host. That is what gives Mochi its features: built-in SQLite, in-memory cache, WebSockets, and Server-Sent Events. You can build complex, data-driven realtime apps with no extra dependency and no external cloud services.

You can host Bun and Mochi at hundreds of hosts. Some popular options are below.

<Callout type="info">
None of the links below are affiliate links or endorsements.
</Callout>

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

## PaaS

Deploy code or containers. The platform manages infrastructure, scaling, and networking.

- [Railway](https://railway.app) — dedicated Bun and Docker support
- [Render](https://render.com) — Docker-based web services, Git-push deploys
- [Fly.io](https://fly.io) — Docker-native, global edge, scale-to-zero
- [Heroku](https://heroku.com) — supports Docker deployments
- [Koyeb](https://koyeb.com) — Git or Docker, 250+ edge locations
- [Clever Cloud](https://www.clever.cloud) — native Bun / Docker support
- [Zeabur](https://zeabur.com) — auto-detects Bun
- [Scaleway Serverless Containers](https://www.scaleway.com/en/serverless-containers/) — deploy from any registry, billed per millisecond
- [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) — Git or Docker deploy

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker).

- [Hetzner](https://hetzner.com)
- [DigitalOcean Droplets](https://www.digitalocean.com/products/droplets)
- [OVHcloud](https://ovhcloud.com)
- [Scaleway Instances](https://www.scaleway.com/en/virtual-instances/)
- [Vultr](https://vultr.com)
- [Akamai / Linode](https://www.linode.com)
- [Kamatera](https://kamatera.com)

## Big cloud

Each offers VPS, serverless, containers, and Kubernetes. Pick the model that fits.

- [AWS](https://aws.amazon.com) — EC2, Lambda + Web Adapter, Fargate, App Runner, ECS/EKS
- [Google Cloud](https://cloud.google.com) — Compute Engine, Cloud Run, GKE, Cloud Functions
- [Azure](https://azure.microsoft.com) — VMs, Container Apps, ACI, AKS
- [Oracle Cloud](https://cloud.oracle.com) — generous always-free ARM VMs
- [IBM Cloud](https://www.ibm.com/cloud) — VPC, Code Engine, IKS/OpenShift

## Self-hosted tools

Install these on a VPS from one of the providers above.

- [Coolify](https://coolify.io) — open-source, self-hosted PaaS
- [Dokku](https://dokku.com) — open-source mini-Heroku
- [CapRover](https://caprover.com) — open-source PaaS with web UI

## Hosted tools

Connect to your existing infrastructure at different cloud providers.

- [Northflank](https://northflank.com) — containers, jobs, APIs; bring-your-own-cloud
- [Kuberns](https://kuberns.com) — Git-push deploy on AWS infra, no Dockerfile
- [Convox](https://www.convox.com/)
