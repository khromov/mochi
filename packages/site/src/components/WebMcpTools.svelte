<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  // navigator.modelContext is not in the DOM lib types yet; declare the minimal
  // WebMCP surface we use so this typechecks under strict TS.
  type ToolResult = { content: Array<{ type: 'text'; text: string }> };
  type ToolDescriptor = {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    execute: (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
  };
  type ModelContext = { provideContext?: (context: { tools: ToolDescriptor[] }) => void };

  type LlmsEntry = { title: string; description: string; url: string };
  type LlmsIndex = { docs: LlmsEntry[]; demos: LlmsEntry[] };

  // Register WebMCP tools so in-browser agents discover the site's capabilities
  // on load. The WebMCP surface is still unstable across drafts/implementations,
  // so feature-check that provideContext is actually callable and degrade to a
  // warning rather than throwing (an unhandled throw here aborts hydration).
  const modelContext = isBrowser ? (navigator as unknown as { modelContext?: ModelContext }).modelContext : undefined;

  if (modelContext && typeof modelContext.provideContext !== 'function') {
    console.warn('[WebMCP] navigator.modelContext.provideContext is unavailable; skipping tool registration.');
  }

  if (modelContext && typeof modelContext.provideContext === 'function') {
    try {
      modelContext.provideContext({
        tools: [
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

              const docs = matches(index.docs ?? []);
              const demos = matches(index.demos ?? []);
              const all = [...docs, ...demos];

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
        ],
      });
    } catch (err) {
      console.warn('[WebMCP] tool registration failed:', err);
    }
  }
</script>
