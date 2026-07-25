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

## Relocatable builds

`mochi-framework build` writes every artifact path relative to the out-dir, so you can build in one place and run in another — build in a CI stage, copy `.mochi/` into the final image, move or rename the directory. Point the runtime at wherever the output landed:

```ts
Mochi.serve({ outDir: './.mochi' }); // default — or wherever you copied it
```

Paths resolve against the manifest's own directory, so pointing `manifest` at a relocated build works on its own:

```ts
Mochi.serve({ manifest: '/srv/app/build/manifest.json' });
```

<Callout type="warning">

Three things still anchor a prebuilt app to its project. **Run it the way you built it:** route component paths (`Mochi.page('./src/Site.svelte')`) double as manifest lookup keys, so the working directory must resolve them to the same strings — use project-relative paths and boot from the project root. **Keep the out-dir in the project tree:** the compiled SSR modules resolve `node_modules` from the out-dir's location. **On-demand server islands need sources:** islands missing from the manifest are compiled at request time from source paths recorded at build. Prebuilt islands (the normal case) don't — they relocate fine.

</Callout>

<Callout type="info">

The manifest is versioned. A build from a newer `mochi-framework` than the runtime booting it will log a warning and may fail to load — build and serve with the same version.

</Callout>

## PaaS

Deploy code or containers — the platform manages infrastructure, scaling, and networking.

- <span title="USA">🇺🇸</span> <a href="https://railway.app" target="_blank" rel="nofollow noopener">Railway</a> — Both dedicated Bun and Docker support
- <span title="USA">🇺🇸</span> <a href="https://render.com" target="_blank" rel="nofollow noopener">Render</a> — Docker-based web services, Git-push deploys
- <span title="USA">🇺🇸</span> <a href="https://fly.io" target="_blank" rel="nofollow noopener">Fly.io</a> — Docker-native, global edge, scale-to-zero
- <span title="USA">🇺🇸</span> <a href="https://heroku.com" target="_blank" rel="nofollow noopener">Heroku</a> — supports Docker deployments
- <span title="France">🇫🇷</span> <a href="https://koyeb.com" target="_blank" rel="nofollow noopener">Koyeb</a> — Git or Docker, 250+ edge locations
- <span title="France">🇫🇷</span> <a href="https://www.clever.cloud" target="_blank" rel="nofollow noopener">Clever Cloud</a> — native Bun / Docker support
- <span title="USA — Zeabur Inc., Delaware">🇺🇸</span> <a href="https://zeabur.com" target="_blank" rel="nofollow noopener">Zeabur</a> — auto-detects Bun
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/serverless-containers/" target="_blank" rel="nofollow noopener">Scaleway Serverless Containers</a> — deploy from any registry, billed per millisecond
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/app-platform" target="_blank" rel="nofollow noopener">DigitalOcean App Platform</a> — Git or Docker deploy

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker, etc.).

- <span title="Germany">🇩🇪</span> <a href="https://hetzner.com" target="_blank" rel="nofollow noopener">Hetzner</a> — very cheap, popular with indie devs
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/droplets" target="_blank" rel="nofollow noopener">DigitalOcean Droplets</a> — simple cloud VMs
- <span title="France">🇫🇷</span> <a href="https://ovhcloud.com" target="_blank" rel="nofollow noopener">OVHcloud</a> — dedicated servers, VPS, private cloud; strong GDPR compliance
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/virtual-instances/" target="_blank" rel="nofollow noopener">Scaleway Instances</a> — Offers VMs alongside their serverless offering
- <span title="USA">🇺🇸</span> <a href="https://vultr.com" target="_blank" rel="nofollow noopener">Vultr</a>
- <span title="USA">🇺🇸</span> <a href="https://www.linode.com" target="_blank" rel="nofollow noopener">Akamai / Linode</a>
- <span title="USA">🇺🇸</span><span title="Israeli-founded">🇮🇱</span> <a href="https://kamatera.com" target="_blank" rel="nofollow noopener">Kamatera</a> — pay-as-you-go cloud VMs

## Big Cloud (multiple deployment options)

Each of these offers VPS, serverless, containers, and Kubernetes — pick the model that fits.

- <span title="USA">🇺🇸</span> <a href="https://aws.amazon.com" target="_blank" rel="nofollow noopener">AWS</a> — EC2 (VPS), Lambda + Web Adapter (serverless), Fargate (serverless containers), App Runner (PaaS), ECS/EKS (orchestrated)
- <span title="USA">🇺🇸</span> <a href="https://cloud.google.com" target="_blank" rel="nofollow noopener">Google Cloud</a> — Compute Engine (VPS), Cloud Run (serverless containers), GKE (Kubernetes), Cloud Functions
- <span title="USA">🇺🇸</span> <a href="https://azure.microsoft.com" target="_blank" rel="nofollow noopener">Azure</a> — VMs (VPS), Container Apps (serverless), ACI (containers), AKS (Kubernetes)
- <span title="USA">🇺🇸</span> <a href="https://cloud.oracle.com" target="_blank" rel="nofollow noopener">Oracle Cloud</a> — generous always-free tier (ARM VMs)
- <span title="USA">🇺🇸</span> <a href="https://www.ibm.com/cloud" target="_blank" rel="nofollow noopener">IBM Cloud</a> — VPC (VPS), Code Engine (serverless containers), IKS/OpenShift (Kubernetes)

## Self-hosted tools

Not platforms themselves — you install these on a VPS from one of the providers above.

- <a href="https://coolify.io" target="_blank" rel="nofollow noopener">Coolify</a> — open-source, self-hosted PaaS
- <a href="https://dokku.com" target="_blank" rel="nofollow noopener">Dokku</a> — open-source mini-Heroku
- <a href="https://caprover.com" target="_blank" rel="nofollow noopener">CapRover</a> — open-source PaaS with web UI

## Hosted tools

Connect to your existing infrastructure at different cloud providers

- <span title="United Kingdom">🇬🇧</span> <a href="https://northflank.com" target="_blank" rel="nofollow noopener">Northflank</a> — containers, jobs, APIs; bring-your-own-cloud
- <span title="India">🇮🇳</span> <a href="https://kuberns.com" target="_blank" rel="nofollow noopener">Kuberns</a> — Git-push deploy on AWS infra, no Dockerfile needed
- <span title="USA">🇺🇸</span> <a href="https://www.convox.com/" target="_blank" rel="nofollow noopener">Convox</a>

## Where these companies are based

The flag next to each provider above reflects where the **company** is headquartered (not where its data centers are).

<details>
<summary style="cursor: pointer">Provider headquarters &amp; sources</summary>

<!-- prettier-ignore -->
| Provider | Country | Source |
| --- | --- | --- |
| Railway | 🇺🇸 USA | <a href="https://railway.com/legal/dpa" target="_blank" rel="nofollow noopener">DPA (San Francisco, CA)</a> |
| Render | 🇺🇸 USA | <a href="https://render.com/about" target="_blank" rel="nofollow noopener">About (San Francisco, CA)</a> |
| Fly.io | 🇺🇸 USA | <a href="https://fly.io/legal/terms-of-service/" target="_blank" rel="nofollow noopener">Terms (San Francisco, CA)</a> |
| Heroku | 🇺🇸 USA | <a href="https://www.heroku.com/about" target="_blank" rel="nofollow noopener">About (San Francisco, CA)</a> |
| Koyeb | 🇫🇷 France | <a href="https://www.koyeb.com/careers" target="_blank" rel="nofollow noopener">Careers (Paris, France)</a> |
| Clever Cloud | 🇫🇷 France | <a href="https://clever.cloud/legal-notice/" target="_blank" rel="nofollow noopener">Legal notice (Nantes, France)</a> |
| Zeabur | 🇺🇸 USA | <a href="https://zeabur.com/about" target="_blank" rel="nofollow noopener">About (Zeabur Inc., Delaware)</a> |
| Scaleway | 🇫🇷 France | <a href="https://www.scaleway.com/en/legal-notice/" target="_blank" rel="nofollow noopener">Legal notice (Paris, France)</a> |
| DigitalOcean | 🇺🇸 USA | <a href="https://www.digitalocean.com/legal/terms-of-service-agreement" target="_blank" rel="nofollow noopener">Terms (USA)</a> |
| Hetzner | 🇩🇪 Germany | <a href="https://www.hetzner.com/legal/imprint" target="_blank" rel="nofollow noopener">Imprint (Gunzenhausen, Germany)</a> |
| OVHcloud | 🇫🇷 France | <a href="https://www.ovhcloud.com/en/terms-and-conditions/" target="_blank" rel="nofollow noopener">Terms (Roubaix, France)</a> |
| Vultr | 🇺🇸 USA | <a href="https://en.wikipedia.org/wiki/Vultr" target="_blank" rel="nofollow noopener">Wikipedia (West Palm Beach, FL)</a> |
| Akamai / Linode | 🇺🇸 USA | <a href="https://www.akamai.com/company" target="_blank" rel="nofollow noopener">Company (Cambridge, MA)</a> |
| Kamatera | 🇺🇸 USA · 🇮🇱 founded | <a href="https://en.wikipedia.org/wiki/Kamatera" target="_blank" rel="nofollow noopener">Wikipedia (US HQ, Israeli-founded)</a> |
| AWS | 🇺🇸 USA | <a href="https://www.aboutamazon.com/about-us" target="_blank" rel="nofollow noopener">About Amazon (Seattle, WA)</a> |
| Google Cloud | 🇺🇸 USA | <a href="https://en.wikipedia.org/wiki/Google" target="_blank" rel="nofollow noopener">Wikipedia (Mountain View, CA)</a> |
| Azure | 🇺🇸 USA | <a href="https://news.microsoft.com/facts-about-microsoft/" target="_blank" rel="nofollow noopener">Microsoft facts (Redmond, WA)</a> |
| Oracle Cloud | 🇺🇸 USA | <a href="https://en.wikipedia.org/wiki/Oracle_Corporation" target="_blank" rel="nofollow noopener">Wikipedia (Austin, TX)</a> |
| IBM Cloud | 🇺🇸 USA | <a href="https://en.wikipedia.org/wiki/IBM" target="_blank" rel="nofollow noopener">Wikipedia (Armonk, NY)</a> |
| Northflank | 🇬🇧 United Kingdom | <a href="https://northflank.com/about" target="_blank" rel="nofollow noopener">About (London, UK)</a> |
| Kuberns | 🇮🇳 India | <a href="https://www.linkedin.com/company/kuberns" target="_blank" rel="nofollow noopener">LinkedIn (Gujarat, India)</a> |
| Convox | 🇺🇸 USA | <a href="https://www.ycombinator.com/companies/convox" target="_blank" rel="nofollow noopener">Y Combinator (Atlanta, GA)</a> |

</details>
