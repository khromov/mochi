---
title: 'Deployment options'
slug: deployment-options
description: 'Where to deploy your Mochi app: PaaS, VPS, big cloud, and self-hosted options.'
---

<script>
import Callout from './_components/Callout.svelte';
import VersionNote from './_components/VersionNote.svelte';
</script>

# Deployment options

Mochi is a **serverful** application, so it does not run on every serverless host. That is what gives Mochi its features: built-in SQLite, in-memory cache, WebSockets, and Server-Sent Events. You can build complex, data-driven realtime apps with no extra dependency and no external cloud services.

You can host Bun and Mochi at hundreds of hosts. Some popular options are below. For how a build behaves once it is deployed — relocatable output, a persistent image cache — see [Production builds](/docs/production-builds/).

<Callout type="info">

None of the links below are affiliate links or endorsements.

</Callout>

## PaaS

Deploy code or containers. The platform manages infrastructure, scaling, and networking.

- <span title="USA">🇺🇸</span> <a href="https://railway.app" target="_blank" rel="nofollow noopener">Railway</a> — dedicated Bun and Docker support
- <span title="USA">🇺🇸</span> <a href="https://render.com" target="_blank" rel="nofollow noopener">Render</a> — Docker-based web services, Git-push deploys
- <span title="USA">🇺🇸</span> <a href="https://fly.io" target="_blank" rel="nofollow noopener">Fly.io</a> — Docker-native, global edge, scale-to-zero
- <span title="USA">🇺🇸</span> <a href="https://heroku.com" target="_blank" rel="nofollow noopener">Heroku</a> — supports Docker deployments
- <span title="France">🇫🇷</span> <a href="https://koyeb.com" target="_blank" rel="nofollow noopener">Koyeb</a> — Git or Docker, 250+ edge locations
- <span title="France">🇫🇷</span> <a href="https://www.clever.cloud" target="_blank" rel="nofollow noopener">Clever Cloud</a> — native Bun / Docker support
- <span title="USA — Zeabur Inc., Delaware">🇺🇸</span> <a href="https://zeabur.com" target="_blank" rel="nofollow noopener">Zeabur</a> — auto-detects Bun
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/serverless-containers/" target="_blank" rel="nofollow noopener">Scaleway Serverless Containers</a> — deploy from any registry, billed per millisecond
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/app-platform" target="_blank" rel="nofollow noopener">DigitalOcean App Platform</a> — Git or Docker deploy

## Traditional VPS / IaaS

You get a server, install Bun yourself, and manage the process (systemd, Docker).

- <span title="Germany">🇩🇪</span> <a href="https://hetzner.com" target="_blank" rel="nofollow noopener">Hetzner</a> — very cheap, popular with indie devs
- <span title="USA">🇺🇸</span> <a href="https://www.digitalocean.com/products/droplets" target="_blank" rel="nofollow noopener">DigitalOcean Droplets</a> — simple cloud VMs
- <span title="France">🇫🇷</span> <a href="https://ovhcloud.com" target="_blank" rel="nofollow noopener">OVHcloud</a> — dedicated servers, VPS, private cloud, with strong GDPR compliance
- <span title="France">🇫🇷</span> <a href="https://www.scaleway.com/en/virtual-instances/" target="_blank" rel="nofollow noopener">Scaleway Instances</a> — VMs alongside their serverless offering
- <span title="USA">🇺🇸</span> <a href="https://vultr.com" target="_blank" rel="nofollow noopener">Vultr</a>
- <span title="USA">🇺🇸</span> <a href="https://www.linode.com" target="_blank" rel="nofollow noopener">Akamai / Linode</a>
- <span title="USA">🇺🇸</span><span title="Israeli-founded">🇮🇱</span> <a href="https://kamatera.com" target="_blank" rel="nofollow noopener">Kamatera</a> — pay-as-you-go cloud VMs

## Big cloud

Each offers VPS, serverless, containers, and Kubernetes. Pick the model that fits.

- <span title="USA">🇺🇸</span> <a href="https://aws.amazon.com" target="_blank" rel="nofollow noopener">AWS</a> — EC2, Lambda + Web Adapter, Fargate, App Runner, ECS/EKS
- <span title="USA">🇺🇸</span> <a href="https://cloud.google.com" target="_blank" rel="nofollow noopener">Google Cloud</a> — Compute Engine, Cloud Run, GKE, Cloud Functions
- <span title="USA">🇺🇸</span> <a href="https://azure.microsoft.com" target="_blank" rel="nofollow noopener">Azure</a> — VMs, Container Apps, ACI, AKS
- <span title="USA">🇺🇸</span> <a href="https://cloud.oracle.com" target="_blank" rel="nofollow noopener">Oracle Cloud</a> — generous always-free ARM VMs
- <span title="USA">🇺🇸</span> <a href="https://www.ibm.com/cloud" target="_blank" rel="nofollow noopener">IBM Cloud</a> — VPC, Code Engine, IKS/OpenShift

## Self-hosted tools

Install these on a VPS from one of the providers above.

- <a href="https://coolify.io" target="_blank" rel="nofollow noopener">Coolify</a> — open-source, self-hosted PaaS
- <a href="https://dokku.com" target="_blank" rel="nofollow noopener">Dokku</a> — open-source mini-Heroku
- <a href="https://caprover.com" target="_blank" rel="nofollow noopener">CapRover</a> — open-source PaaS with web UI

## Hosted tools

Connect to your existing infrastructure at different cloud providers.

- <span title="United Kingdom">🇬🇧</span> <a href="https://northflank.com" target="_blank" rel="nofollow noopener">Northflank</a> — containers, jobs, and APIs, with bring-your-own-cloud
- <span title="India">🇮🇳</span> <a href="https://kuberns.com" target="_blank" rel="nofollow noopener">Kuberns</a> — Git-push deploy on AWS infra, no Dockerfile
- <span title="USA">🇺🇸</span> <a href="https://www.convox.com/" target="_blank" rel="nofollow noopener">Convox</a>

## Sub-path and static hosting

Mochi writes absolute URLs for everything it owns: `/_mochi/client/…`, `/_mochi/css/…`, the island `component-url`, and the `import` specifiers inside the client chunks. To host under a sub-path such as `https://user.github.io/my-app/`, bake the prefix in at build time:

```sh
mochi-framework build --asset-prefix /my-app/_mochi
```

The value lands in `manifest.json` and every emitted URL carries it. `Mochi.serve({ assetPrefix })` sets the same thing for on-demand compilation, but once a manifest exists its value wins and a differing `serve()` value only logs a warning.

<Callout type="info">

`assetPrefix` covers framework assets only. Links you write yourself (`href="/about"`) and files in `public/` are served at the paths you give them, so prefix those in your own markup.

</Callout>

The same prefix is what makes a hand-rolled static export work: copy `.mochi/svelte-client` to `<host>/my-app/_mochi/client` and `.mochi/svelte-css` to `<host>/my-app/_mochi/css`, save each prerendered page, and nothing needs rewriting.

### Rewriting URLs yourself

<VersionNote since="0.10.0" message="Before 0.10.0 a relative component-url resolved against the island loader module (/_mochi/client/), not the page." />

If you post-process the HTML into page-relative URLs instead, treat `component-url` like any other attribute: it resolves against the page, so `../_mochi/client/…` on `/my-app/writing/` loads from `/my-app/_mochi/client/`, the same place a `<link href="../_mochi/css/…">` on that page does.

## Where these companies are based

The flag next to each provider above shows where the **company** is headquartered, not where its data centers are.

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
