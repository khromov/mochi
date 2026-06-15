---
title: 'Docs for LLMs'
slug: docs-for-llms
description: 'Access plain-text documentation at /llms.txt and /llms-full.txt for pasting into LLM contexts.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Docs for LLMs

The Mochi documentation is published as plain-text bundles you can paste into an LLM context.

### Full documentation

The full set of docs, concatenated in reading order, is served at [`/llms.txt`](/llms.txt). Use this when you want the model to have the complete picture of the framework API.

### Docs + demo source

[`/llms-full.txt`](/llms-full.txt) includes everything in `/llms.txt` plus the source of every demo (`.svelte` and `.ts` files), grouped by demo name. Use this when the model needs both the API and real working examples.

### Per-document text

Each individual doc is reachable as plain text at `/docs/<slug>/llms.txt`:

- [`/docs/intro/llms.txt`](/docs/intro/llms.txt)
- [`/docs/server-islands/llms.txt`](/docs/server-islands/llms.txt)
- [`/docs/api-routes/llms.txt`](/docs/api-routes/llms.txt)

The "Copy as llms.txt" button on each doc page emits just that page — use it to give the model focused context without the rest of the framework.

### Per-demo source

Each demo's source is reachable as plain text at `/demos/<slug>/llms.txt` — the same per-demo bundle `/llms-full.txt` groups together, scoped to one demo:

- [`/demos/hello-world/llms.txt`](/demos/hello-world/llms.txt)
- [`/demos/chat/llms.txt`](/demos/chat/llms.txt)

### Machine-readable index

[`/llms.json`](/llms.json) returns a JSON index of every doc and demo — each with its `title`, `description`, and an absolute `url` to its `llms.txt`. Use it to discover what's available and fetch each piece on demand:

```json
{
  "docs": [{ "title": "Welcome", "description": "…", "url": "https://mochi.fast/docs/intro/llms.txt" }],
  "demos": [{ "title": "Hello World", "description": "…", "url": "https://mochi.fast/demos/hello-world/llms.txt" }]
}
```

<Callout type="info">
  An MCP server is coming soon.
</Callout>
