<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  // navigator.modelContext is not in the DOM lib types yet; declare the minimal
  // WebMCP surface we use so this typechecks under strict TS. The spec exposes
  // two shapes across drafts/implementations: the native per-tool registerTool()
  // and the older imperative provideContext({ tools }).
  type ToolResult = { content: Array<{ type: 'text'; text: string }> };
  type ToolDescriptor = {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    execute: (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
  };
  type ModelContext = {
    registerTool?: (tool: ToolDescriptor) => unknown;
    provideContext?: (context: { tools: ToolDescriptor[] }) => void;
  };

  type LlmsEntry = { title: string; description: string; url: string };
  type LlmsIndex = { docs: LlmsEntry[]; demos: LlmsEntry[] };

  const tools: ToolDescriptor[] = [
    {
      name: 'search_docs',
      description: 'Search the Mochi documentation and demos by keyword. Returns matching pages with their titles, descriptions, and URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search for across docs and demo titles/descriptions.' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const query = String(input.query ?? '')
          .trim()
          .toLowerCase();
        const res = await fetch('/llms.json');
        const index = (await res.json()) as LlmsIndex;

        const matches = (entries: LlmsEntry[]) =>
          query.length === 0 ? [] : entries.filter((e) => e.title.toLowerCase().includes(query) || e.description.toLowerCase().includes(query));

        const all = [...matches(index.docs ?? []), ...matches(index.demos ?? [])];

        const text = all.length === 0 ? `No matches found for "${query}".` : all.map((e) => `- ${e.title} — ${e.description} (${e.url})`).join('\n');

        return { content: [{ type: 'text', text }] };
      },
    },
    {
      name: 'open_section',
      description: 'Navigate the browser to a section of this site. Only same-origin relative paths are allowed (e.g. "/docs/quick-start").',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'A same-origin path on this site to navigate to, e.g. "/docs".' },
        },
        required: ['url'],
      },
      execute: (input) => {
        const url = String(input.url ?? '').trim();
        const resolved = new URL(url, window.location.href);
        if (resolved.origin !== window.location.origin) {
          return { content: [{ type: 'text', text: `Refused: "${url}" is not a same-origin path.` }] };
        }
        window.location.href = resolved.href;
        return { content: [{ type: 'text', text: `Navigating to ${resolved.pathname}.` }] };
      },
    },
    {
      // Mirrors the "Quick start" copy button on the homepage so an agent can
      // obtain the scaffold command instead of only being able to read it.
      name: 'get_create_command',
      description: 'Get the shell command to scaffold a new Mochi project (`bun create mochi@latest`), copying it to the clipboard when available.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const command = 'bun create mochi@latest';
        try {
          await navigator.clipboard?.writeText(command);
        } catch {
          // Clipboard may be unavailable (no permission / insecure context); returning the text still satisfies the agent.
        }
        return { content: [{ type: 'text', text: command }] };
      },
    },
  ];

  // Register on load so in-browser agents discover the site's capabilities.
  // Prefer the native per-tool registerTool(); fall back to provideContext().
  // Any failure degrades to a warning — an unhandled throw here aborts hydration.
  const modelContext = isBrowser ? (navigator as unknown as { modelContext?: ModelContext }).modelContext : undefined;

  if (modelContext) {
    try {
      if (typeof modelContext.registerTool === 'function') {
        for (const tool of tools) {
          modelContext.registerTool(tool);
        }
      } else if (typeof modelContext.provideContext === 'function') {
        modelContext.provideContext({ tools });
      } else {
        console.warn('[WebMCP] navigator.modelContext exposes neither registerTool() nor provideContext(); skipping tool registration.');
      }
    } catch (err) {
      console.warn('[WebMCP] tool registration failed:', err);
    }
  }
</script>
