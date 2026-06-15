---
title: 'Docs for LLMs'
slug: docs-for-llms
description: 'An llms.txt index at /llms.txt, plus concatenated bundles for pasting into LLM contexts.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Docs for LLMs

The Mochi documentation is published in the [llms.txt](https://llmstxt.org/) format so models can discover and fetch exactly what they need.

### Index

[`/llms.txt`](/llms.txt) is the index: a title, a one-line summary, and a linked list of every doc (`## Docs`) and demo (`## Examples`), each pointing at its own plain-text file. The concatenated bundles below are linked under `## Optional`. Start here.

### All docs concatenated

The full set of docs, concatenated in reading order, is served at [`/llms-recommended.txt`](/llms-recommended.txt). Use this when you want the model to have the complete picture of the framework API in one paste.

### Docs + demo source

[`/llms-full.txt`](/llms-full.txt) includes everything in `/llms-recommended.txt` plus the source of every demo (`.svelte` and `.ts` files), grouped by demo name. Use this when the model needs both the API and real working examples.

### Per-document text

Each individual doc is reachable as plain text at `/docs/<slug>/llms.txt`:

- [`/docs/intro/llms.txt`](/docs/intro/llms.txt)
- [`/docs/server-islands/llms.txt`](/docs/server-islands/llms.txt)
- [`/docs/api-routes/llms.txt`](/docs/api-routes/llms.txt)

The "Copy as llms.txt" button on each doc page emits just that page — use it to give the model focused context without the rest of the framework.

### Per-demo source

Each demo's source is reachable as plain text alongside its demo page — usually `/demos/<slug>/llms.txt`. It's the exact source `/llms-full.txt` bundles for that demo, scoped to one demo:

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

### Agent skill

Mochi publishes a `SKILL.md` — agent guidance that tells a coding assistant to fetch the relevant docs and demos from `/llms.txt` before writing framework code. Pull the latest copy into your project with the CLI:

```sh
bunx mochi-framework update-skill
```

This fetches `https://mochi.fast/SKILL.md` and writes it to `.claude/skills/mochi/SKILL.md`, creating the file if it does not exist or overwriting it if it does. Run it again whenever you upgrade the framework to keep the guidance in sync.

<Callout type="info">
  An MCP server is coming soon.
</Callout>
