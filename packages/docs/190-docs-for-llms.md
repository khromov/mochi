---
title: 'Docs for LLMs'
slug: docs-for-llms
description: 'A remote MCP server, an agent skill, and an llms.txt index with concatenated bundles for pasting into LLM contexts.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import Disclosure from './_components/Disclosure.svelte';
</script>

## LLM integrations

Mochi provides several different ways of integrating LLMs to improve your development experience. We primarily recommend to use _either_ the [**Agent skill**](#agent-skill-recommended) or the [**MCP server**](#mcp-server-recommended). Both will augment your development experience with up-to-date documentation and how-to's on how to do various tasks in Mochi. You can also use the older [llms.txt format](#llmstxt).

### Agent skill (recommended)

Mochi publishes a `SKILL.md` — agent guidance that tells a coding assistant to fetch the relevant docs and demos from `/llms.txt` before writing framework code. Pull the latest copy into your project with the CLI:

```sh
bunx mochi-framework update-skill [agent]
```

This fetches `https://mochi.fast/SKILL.md` and writes it into your project, creating the file if it does not exist or overwriting it if it does. Run it again whenever you upgrade the framework to keep the guidance in sync.

The optional `agent` argument controls where the skill is written (default: `claude-code`):

| Agent                 | Destination                       |
| --------------------- | --------------------------------- |
| `claude-code`         | `.claude/skills/mochi/SKILL.md`   |
| `opencode`            | `.opencode/skills/mochi/SKILL.md` |
| `antigravity` (`agy`) | `.agents/skills/mochi/SKILL.md`   |
| `codex`               | `.agents/skills/mochi/SKILL.md`   |

### MCP Server (recommended)

Mochi runs an official remote MCP server at `https://mochi.fast/mcp` (HTTP transport). It exposes the same docs and demos as the skill — `get_documentation_sections` to list everything and `get_section` to read specific pages — so an assistant can pull exactly the context it needs. Add it to your tool of choice below.

<Disclosure title="Claude Code">

Run:

```sh
claude mcp add -t http -s project mochi https://mochi.fast/mcp
```

This adds the server at `project` scope (shared via `.mcp.json`); pass `-s user` or `-s local` instead to change that. (For the skill-based alternative, see [Agent skill](#agent-skill-recommended) above.)

</Disclosure>

<Disclosure title="Claude Desktop">

1. Open **Settings > Connectors**
2. Click **Add Custom Connector**
3. Name it `mochi`
4. Set the remote MCP server URL to `https://mochi.fast/mcp`
5. Click **Add**

</Disclosure>

<Disclosure title="Codex CLI">

Add to `~/.codex/config.toml`:

```toml
experimental_use_rmcp_client = true
[mcp_servers.mochi]
url = "https://mochi.fast/mcp"
```

</Disclosure>

<Disclosure title="Copilot CLI">

Run `/mcp add`, or edit `~/.copilot/mcp-config.json`:

```json
{ "mcpServers": { "mochi": { "url": "https://mochi.fast/mcp" } } }
```

</Disclosure>

<Disclosure title="Antigravity Editor">

Open the MCP store via the **"..."** dropdown at the top of the editor's agent panel, click **Manage MCP Servers**, then **View raw config**, and add the server to the config:

```json
{ "mcpServers": { "mochi": { "type": "http", "serverUrl": "https://mochi.fast/mcp" } } }
```

</Disclosure>

<Disclosure title="Antigravity CLI (previously Gemini)">

Edit `~/.gemini/config/mcp_config.json` and add the server:

```json
{ "mcpServers": { "mochi": { "type": "http", "serverUrl": "https://mochi.fast/mcp" } } }
```

</Disclosure>

<Disclosure title="OpenCode">

Run `opencode mcp add`, choose **Remote**, name it `mochi`, and enter `https://mochi.fast/mcp`.

</Disclosure>

<Disclosure title="VS Code">

1. Open the command palette
2. Select **MCP: Add Server...**
3. Choose **HTTP (HTTP or Server-Sent-Events)**
4. Enter `https://mochi.fast/mcp` and press Enter
5. Name it `mochi`
6. Choose Global or Workspace scope

</Disclosure>

<Disclosure title="Cursor">

Open the command palette, select **View: Open MCP Settings**, click **Add custom MCP**, and add:

```json
{ "mcpServers": { "mochi": { "url": "https://mochi.fast/mcp" } } }
```

</Disclosure>

<Disclosure title="GitHub Coding Agent">

In your repo, go to **Settings > Copilot > Coding agent**, edit the MCP configuration, then save:

```json
{ "mcpServers": { "mochi": { "type": "http", "url": "https://mochi.fast/mcp", "tools": ["*"] } } }
```

</Disclosure>

<Disclosure title="Other clients">

Refer to your client's documentation for adding a remote MCP server and use `https://mochi.fast/mcp` as the URL.

</Disclosure>

### llms.txt

[`/llms.txt`](/llms.txt) is the index: a title, a one-line summary, and a linked list of every doc (`## Docs`), demo (`## Examples`), and blog post (`## Blog`), each pointing at its own plain-text file. The `## Docs` list ends with the changelog. The concatenated bundles below are linked under `## Optional`. Start here.

#### All docs concatenated

The full set of docs, concatenated in reading order, is served at [`/llms-recommended.txt`](/llms-recommended.txt). Use this when you want the model to have the complete picture of the framework API in one paste.

#### Docs + demo source

[`/llms-full.txt`](/llms-full.txt) includes everything in `/llms-recommended.txt` plus the source of every demo (`.svelte` and `.ts` files) grouped by demo name, every blog post, and the changelog. Use this when the model needs both the API and real working examples.

#### Per-document text

Each individual doc is reachable as plain text at `/docs/<slug>/llms.txt`:

- [`/docs/intro/llms.txt`](/docs/intro/llms.txt)
- [`/docs/server-islands/llms.txt`](/docs/server-islands/llms.txt)
- [`/docs/api-routes/llms.txt`](/docs/api-routes/llms.txt)

The "Copy as llms.txt" button on each doc page emits just that page — use it to give the model focused context without the rest of the framework.

The changelog is served the same way at [`/docs/changelog/llms.txt`](/docs/changelog/llms.txt) — the record of what changed in each `mochi-framework` version, also readable as a page at [`/docs/changelog/`](/docs/changelog/). It's fetched from GitHub, so both return `503` (not `404`) if that fetch is ever unavailable.

#### Per-post text

Each published blog post is reachable as raw markdown at `/blog/<slug>/llms.txt`:

- [`/blog/mochi-0-8-0/llms.txt`](/blog/mochi-0-8-0/llms.txt)

#### Per-demo source

Each demo's source is reachable as plain text alongside its demo page — usually `/demos/<slug>/llms.txt`. It's the exact source `/llms-full.txt` bundles for that demo, scoped to one demo:

- [`/demos/hello-world/llms.txt`](/demos/hello-world/llms.txt)
- [`/demos/chat/llms.txt`](/demos/chat/llms.txt)

#### Machine-readable index

[`/llms.json`](/llms.json) returns a JSON index of every doc, blog post, and demo — each with its `title`, `description`, and an absolute `url` to its `llms.txt`. The changelog is the last entry in `docs`. Use it to discover what's available and fetch each piece on demand:

```json
{
  "docs": [{ "title": "Welcome", "description": "…", "url": "https://mochi.fast/docs/intro/llms.txt" }],
  "posts": [{ "title": "Mochi 0.8.0", "description": "2026-07-21 — …", "url": "https://mochi.fast/blog/mochi-0-8-0/llms.txt" }],
  "demos": [{ "title": "Hello World", "description": "…", "url": "https://mochi.fast/demos/hello-world/llms.txt" }]
}
```
