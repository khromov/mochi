---
title: 'Deployment options'
slug: deployment-options
description: 'Where to deploy your Mochi app — PaaS, VPS, big cloud, and self-hosted options.'
---

<script>
import Callout from './_components/Callout.svelte';
</script>

# Deployment options

Mochi is at its heart a _serverful_ application. That means it doesn't run on _some_ serverless hosts. While this can seem like a limitation, it is actually what gives Mochi its superpowers - features like built-in SQLite support, in-memory cache and built-in support for WebSockets and Server-Sent Events. You can easily build complex, data-driven realtime applications with Mochi without a single extra dependency or any external cloud services. It's both leaner _and_ cheaper.

You can host Bun and Mochi at hundreds of different hosts. We list some of the most popular options below.

<Callout type="info">
None of the links below are affiliate links, nor should any of the links be seen as endorsements.
</Callout>

## PaaS

Deploy code or containers — the platform manages infrastructure, scaling, and networking.

- [Railway](https://railway.app) — Both dedicated Bun and Docker support
- [Render](https://render.com) — Docker-based web services, Git-push deploys
- [Fly.io](https://fly.io) — Docker-native, global edge, scale-to-zero
- [Heroku](https://heroku.com) — supports Docker deployments
- [Koyeb](https://koyeb.com) — Git or Docker, 250+ edge locations
- [Clever Cloud](https://www.clever.cloud) — native Bun / Docker support
- [Zeabur](https://zeabur.com) — auto-detects Bun
- [Scaleway Serverless Containers](https://www.scaleway.com/en/serverless-containers/) — deploy from any registry, billed per millisecond
- [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) — Git or Docker deploy

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker, etc.).

- [Hetzner](https://hetzner.com) — very cheap, popular with indie devs (German)
- [DigitalOcean Droplets](https://www.digitalocean.com/products/droplets) — simple cloud VMs
- [OVHcloud](https://ovhcloud.com) — dedicated servers, VPS, private cloud; strong GDPR compliance
- [Scaleway Instances](https://www.scaleway.com/en/virtual-instances/) — Offers VMs alongside their serverless offering
- [Vultr](https://vultr.com)
- [Akamai / Linode](https://www.linode.com)
- [Kamatera](https://kamatera.com) — pay-as-you-go cloud VMs

## Big Cloud (multiple deployment options)

Each of these offers VPS, serverless, containers, and Kubernetes — pick the model that fits.

- [AWS](https://aws.amazon.com) — EC2 (VPS), Lambda + Web Adapter (serverless), Fargate (serverless containers), App Runner (PaaS), ECS/EKS (orchestrated)
- [Google Cloud](https://cloud.google.com) — Compute Engine (VPS), Cloud Run (serverless containers), GKE (Kubernetes), Cloud Functions
- [Azure](https://azure.microsoft.com) — VMs (VPS), Container Apps (serverless), ACI (containers), AKS (Kubernetes)
- [Oracle Cloud](https://cloud.oracle.com) — generous always-free tier (ARM VMs)

## Self-hosted tools

Not platforms themselves — you install these on a VPS from one of the providers above.

- [Coolify](https://coolify.io) — open-source, self-hosted PaaS
- [Dokku](https://dokku.com) — open-source mini-Heroku
- [CapRover](https://caprover.com) — open-source PaaS with web UI

## Hosted tools

Connect to your existing infrastructure at different cloud providers

- [Northflank](https://northflank.com) — containers, jobs, APIs; bring-your-own-cloud
- [Kuberns](https://kuberns.com) — Git-push deploy on AWS infra, no Dockerfile needed
- [Convox](https://www.convox.com/)
