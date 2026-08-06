---
title: 'Architecture'
slug: architecture
description: 'The high-level model behind a Mochi app: server-first rendering, islands, programmatic routes, and the request lifecycle.'
---

## Architecture

This page describes the model behind a Mochi app — what happens on each request and how the pieces fit together. You do not need any of it to build an app. The feature docs cover every API directly.

### Server-first rendering

Mochi renders each page to HTML on the server. A page ships zero client JavaScript by default. You opt individual components into the browser by marking them as **islands** with a `mochi:*` directive. Everything outside an island stays static HTML.

See [Selective hydration](/docs/selective-hydration/), [Client-only components](/docs/client-only/), and [Server islands](/docs/server-islands/) for the directives.

### Programmatic routes

Routes are a plain `Record<string, MochiRouteValue>` passed to `Mochi.serve({ routes })`. Each key is a URL pattern. Each value comes from `Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`, or `Mochi.file`. There is no file-based routing.

See [Defining routes](/docs/defining-routes/).

### The request lifecycle

1. A request matches a route pattern.
2. Your `handle` middleware runs in order, and can read or rewrite the request and the response.
3. The matched route produces a response — a rendered page, a JSON payload, a stream, or a file.
4. Hydratable islands and deferred server islands (`mochi:defer`) load afterwards, each on its own request.

See [Middleware](/docs/middleware/) and [Request context](/docs/request-context/).

### The Bun runtime

Mochi runs on Bun and builds on its standard library for the bundler, the HTTP and WebSocket server, and native SQLite and PostgreSQL.

See [Why Bun?](/docs/why-bun/).
