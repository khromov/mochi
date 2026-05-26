---
title: 'Deployment options'
slug: deployment-options
description: 'Where to deploy your Mochi app — PaaS, VPS, big cloud, and self-hosted options.'
---

<script>
import Callout from './_components/Callout.svelte';
</script>

# Deployment options

Mochi is at its heart a _serverful_ application. That means it doesn't run on _some_ serverless hosts. While this can seem like a limitation, it is actually what enabled Bun and Mochis superpowers - features like built-in SQLite support, in-memory cache,

<Callout type="info">
None of the links below are affiliate links.
</Callout>

## PaaS

Deploy code or containers — the platform manages infrastructure, scaling, and networking.

- [Railway](https://railway.app) — auto-detects Bun, native `Bun.serve()` support
- [Render](https://render.com) — Docker-based web services, Git-push deploys
- [Fly.io](https://fly.io) — Docker-native, global edge, scale-to-zero
- [Heroku](https://heroku.com) — supports Docker deployments
- [Koyeb](https://koyeb.com) — Git or Docker, 250+ edge locations
- [Clever Cloud](https://clever-cloud.com) — native Bun support (French, Nantes)
- [Zeabur](https://zeabur.com) — auto-detects Bun, set `Bun.env.PORT`
- [Northflank](https://northflank.com) — containers, jobs, APIs; bring-your-own-cloud
- [Kuberns](https://kuberns.com) — Git-push deploy on AWS infra, no Dockerfile needed
- [Scaleway Serverless Containers](https://www.scaleway.com/en/serverless-containers/) — deploy from any registry, billed per millisecond (French, Paris)
- [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) — Git or Docker deploy
- [Google Cloud Run](https://cloud.google.com/run) — serverless containers, scale-to-zero
- [AWS App Runner](https://aws.amazon.com/apprunner/) — fully managed container service
- [Azure Container Apps](https://azure.microsoft.com/en-us/products/container-apps) — serverless containers with auto-scaling

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker, etc.).

- [Hetzner](https://hetzner.com) — very cheap, popular with indie devs (German)
- [DigitalOcean Droplets](https://www.digitalocean.com/products/droplets) — simple cloud VMs
- [OVHcloud](https://ovhcloud.com) — dedicated servers, VPS, private cloud; strong GDPR compliance (French, Roubaix)
- [Scaleway Instances](https://www.scaleway.com/en/virtual-instances/) — VMs alongside their serverless offering (French, Paris)
- [Vultr](https://vultr.com)
- [Akamai / Linode](https://www.linode.com)
- [Kamatera](https://kamatera.com) — pay-as-you-go cloud VMs
- [IONOS](https://ionos.com)
- [Oracle Cloud](https://cloud.oracle.com) — generous always-free tier (ARM VMs)

## Big Cloud (multiple deployment options)

Each of these offers VPS, serverless, containers, and Kubernetes — pick the model that fits.

- [AWS](https://aws.amazon.com) — EC2 (VPS), Lambda + Web Adapter (serverless), Fargate (serverless containers), App Runner (PaaS), ECS/EKS (orchestrated)
- [Google Cloud](https://cloud.google.com) — Compute Engine (VPS), Cloud Run (serverless containers), GKE (Kubernetes), Cloud Functions
- [Azure](https://azure.microsoft.com) — VMs (VPS), Container Apps (serverless), ACI (containers), AKS (Kubernetes)

## Self-hosted tools

Not platforms themselves — you install these on a VPS from one of the providers above.

- [Coolify](https://coolify.io) — open-source, self-hosted PaaS
- [Dokku](https://dokku.com) — open-source mini-Heroku
- [CapRover](https://caprover.com) — open-source PaaS with web UI

---

**Applies to all:** make sure `Bun.serve()` binds to `0.0.0.0` (not `localhost`) and reads the port from `process.env.PORT` or `Bun.env.PORT`.
