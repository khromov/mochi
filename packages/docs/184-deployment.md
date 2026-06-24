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

- <span title="USA">🇺🇸</span> <a href="https://railway.app" rel="nofollow">Railway</a> — Both dedicated Bun and Docker support
- <span title="USA">🇺🇸</span> <a href="https://render.com" rel="nofollow">Render</a> — Docker-based web services, Git-push deploys
- <span title="USA">🇺🇸</span> <a href="https://fly.io" rel="nofollow">Fly.io</a> — Docker-native, global edge, scale-to-zero
- <span title="USA">🇺🇸</span> <a href="https://heroku.com" rel="nofollow">Heroku</a> — supports Docker deployments
- <span title="France">🇫🇷</span> <a href="https://koyeb.com" rel="nofollow">Koyeb</a> — Git or Docker, 250+ edge locations
- <span title="France">🇫🇷</span> <a href="https://www.clever.cloud" rel="nofollow">Clever Cloud</a> — native Bun / Docker support
- <span title="Singapore">🇸🇬</span> <a href="https://zeabur.com" rel="nofollow">Zeabur</a> — auto-detects Bun
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/serverless-containers/" rel="nofollow">Scaleway Serverless Containers</a> — deploy from any registry, billed per millisecond
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/app-platform" rel="nofollow">DigitalOcean App Platform</a> — Git or Docker deploy

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker, etc.).

- <span title="Germany">🇩🇪</span> <a href="https://hetzner.com" rel="nofollow">Hetzner</a> — very cheap, popular with indie devs
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/droplets" rel="nofollow">DigitalOcean Droplets</a> — simple cloud VMs
- <span title="France">🇫🇷</span> <a href="https://ovhcloud.com" rel="nofollow">OVHcloud</a> — dedicated servers, VPS, private cloud; strong GDPR compliance
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/virtual-instances/" rel="nofollow">Scaleway Instances</a> — Offers VMs alongside their serverless offering
- <span title="USA">🇺🇸</span> <a href="https://vultr.com" rel="nofollow">Vultr</a>
- <span title="USA">🇺🇸</span> <a href="https://www.linode.com" rel="nofollow">Akamai / Linode</a>
- <span title="USA">🇺🇸</span><span title="Israeli-founded">🇮🇱</span> <a href="https://kamatera.com" rel="nofollow">Kamatera</a> — pay-as-you-go cloud VMs (Israeli-founded, HQ in New York)

## Big Cloud (multiple deployment options)

Each of these offers VPS, serverless, containers, and Kubernetes — pick the model that fits.

- <span title="USA">🇺🇸</span> <a href="https://aws.amazon.com" rel="nofollow">AWS</a> — EC2 (VPS), Lambda + Web Adapter (serverless), Fargate (serverless containers), App Runner (PaaS), ECS/EKS (orchestrated)
- <span title="USA">🇺🇸</span> <a href="https://cloud.google.com" rel="nofollow">Google Cloud</a> — Compute Engine (VPS), Cloud Run (serverless containers), GKE (Kubernetes), Cloud Functions
- <span title="USA">🇺🇸</span> <a href="https://azure.microsoft.com" rel="nofollow">Azure</a> — VMs (VPS), Container Apps (serverless), ACI (containers), AKS (Kubernetes)
- <span title="USA">🇺🇸</span> <a href="https://cloud.oracle.com" rel="nofollow">Oracle Cloud</a> — generous always-free tier (ARM VMs)

## Self-hosted tools

Not platforms themselves — you install these on a VPS from one of the providers above.

- [Coolify](https://coolify.io) — open-source, self-hosted PaaS
- [Dokku](https://dokku.com) — open-source mini-Heroku
- [CapRover](https://caprover.com) — open-source PaaS with web UI

## Hosted tools

Connect to your existing infrastructure at different cloud providers

- <span title="United Kingdom">🇬🇧</span> <a href="https://northflank.com" rel="nofollow">Northflank</a> — containers, jobs, APIs; bring-your-own-cloud
- <span title="India">🇮🇳</span> <a href="https://kuberns.com" rel="nofollow">Kuberns</a> — Git-push deploy on AWS infra, no Dockerfile needed
- <span title="USA">🇺🇸</span> <a href="https://www.convox.com/" rel="nofollow">Convox</a>
