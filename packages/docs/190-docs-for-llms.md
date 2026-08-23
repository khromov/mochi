---
title: 'Docs for LLMs'
slug: docs-for-llms
description: 'A remote MCP server, an agent skill, and an llms.txt index with concatenated bundles for LLM contexts.'
---

<script>
  import Callout from './_components/Callout.svelte';
  import Disclosure from './_components/Disclosure.svelte';
</script>

## LLM integrations

Mochi offers several ways to give an LLM up-to-date documentation. We recommend either the [**Agent skill**](#agent-skill-recommended) or the [**MCP server**](#mcp-server-recommended). You can also use the older [llms.txt format](#llmstxt).

Upgrading rather than writing new code? [`/docs/migrations/llms.txt`](/docs/migrations/llms.txt) is one page an agent can work through on its own — every breaking change with its symptom, the call sites to grep for, and the option to set.

### Agent skill (recommended)

Mochi publishes a `SKILL.md` that tells a coding assistant to fetch the relevant docs and demos from `/llms.txt` before writing framework code. Pull the latest copy into your project with the CLI:

```sh
bunx mochi-framework update-skill [agent]
```

This fetches `https://mochi.fast/SKILL.md` and writes it into your project. Run it again whenever you upgrade the framework.

The optional `agent` argument controls where the skill is written (default: `claude-code`):

| Agent                 | Destination                       |
| --------------------- | --------------------------------- |
| `claude-code`         | `.claude/skills/mochi/SKILL.md`   |
| `opencode`            | `.opencode/skills/mochi/SKILL.md` |
| `antigravity` (`agy`) | `.agents/skills/mochi/SKILL.md`   |
| `codex`               | `.agents/skills/mochi/SKILL.md`   |

### MCP Server (recommended)

Mochi runs an official remote MCP server at `https://mochi.fast/mcp` (HTTP transport). It exposes the same docs and demos as the skill — `get_documentation_sections` to list everything and `get_section` to read specific pages. Add it to your tool of choice below.

<Disclosure title="Claude Code">

Run:

```sh
claude mcp add -t http -s project mochi https://mochi.fast/mcp
```

This adds the server at `project` scope. Pass `-s user` or `-s local` to change that.

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

Open the MCP store via the **"..."** dropdown at the top of the agent panel, click **Manage MCP Servers**, then **View raw config**, and add:

```json
{ "mcpServers": { "mochi": { "type": "http", "serverUrl": "https://mochi.fast/mcp" } } }
```

</Disclosure>

<Disclosure title="Antigravity CLI (previously Gemini)">

Edit `~/.gemini/config/mcp_config.json` and add:

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

[`/llms.txt`](/llms.txt) is the index: a title, a one-line summary, and a linked list of every doc (`## Docs`), demo (`## Examples`), and blog post (`## Blog`), each pointing at its own plain-text file. The concatenated bundles below are linked under `## Optional`.

#### All docs concatenated

The full set of docs, concatenated in reading order, is served at [`/llms-recommended.txt`](/llms-recommended.txt). Use it when you want the model to have the complete API in one paste.

#### Docs + demo source

[`/llms-full.txt`](/llms-full.txt) includes everything in `/llms-recommended.txt` plus the source of every demo, every blog post, and the changelog. Use it when the model needs both the API and working examples.

#### Per-document text

Each doc is reachable as plain text at `/docs/<slug>/llms.txt`, for example [`/docs/intro/llms.txt`](/docs/intro/llms.txt). The "Copy as llms.txt" button on each doc page emits just that page.

The changelog is served the same way at [`/docs/changelog/llms.txt`](/docs/changelog/llms.txt), and reads as a page at [`/docs/changelog/`](/docs/changelog/). Mochi fetches it from GitHub, so both return `503` (not `404`) when that fetch is unavailable.

#### Per-post text

Each published blog post is reachable as raw markdown at `/blog/<slug>/llms.txt`, for example [`/blog/mochi-0-8-0/llms.txt`](/blog/mochi-0-8-0/llms.txt).

#### Per-demo source

Each demo's source is reachable as plain text alongside its demo page, usually `/demos/<slug>/llms.txt`. It is the exact source `/llms-full.txt` bundles for that demo, scoped to one demo:

- [`/demos/hello-world/llms.txt`](/demos/hello-world/llms.txt)
- [`/demos/chat/llms.txt`](/demos/chat/llms.txt)

#### Machine-readable index

[`/llms.json`](/llms.json) returns a JSON index of every doc, blog post, and demo, each with its `title`, `description`, and an absolute `url` to its `llms.txt`.

```json
{
  "docs": [{ "title": "Welcome", "description": "…", "url": "https://mochi.fast/docs/intro/llms.txt" }],
  "posts": [{ "title": "Mochi 0.8.0", "description": "2026-07-21 — …", "url": "https://mochi.fast/blog/mochi-0-8-0/llms.txt" }],
  "demos": [{ "title": "Hello World", "description": "…", "url": "https://mochi.fast/demos/hello-world/llms.txt" }]
}
```
