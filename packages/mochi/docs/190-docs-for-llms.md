---
title: 'Docs for LLMs'
slug: docs-for-llms
---

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
