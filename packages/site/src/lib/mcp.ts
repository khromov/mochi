import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport } from '@tmcp/transport-http';
import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };
import { logger } from 'mochi-framework';
import { McpServer } from 'tmcp';
import { tool } from 'tmcp/utils';
import * as v from 'valibot';
import { buildSectionIndex, getDemoLlmsTxt, getDocLlmsTxt } from './docs';

const adapter = new ValibotJsonSchemaAdapter();

export const mcpServer = new McpServer(
  {
    name: 'mochi-docs',
    version: `${mochiPkg.version}`,
    description:
      'Official documentation and demos for the Mochi framework (SSR-first Svelte 5 on Bun with islands-based hydration). ALWAYS consult this server before writing or changing code in an application built on Mochi: call get_documentation_sections to see what exists, then get_section to read the relevant docs and demos. The framework has its own APIs and conventions, so do not rely on prior assumptions — verify against these docs first.',
  },
  {
    adapter,
    capabilities: { tools: { listChanged: false } },
  },
);

// Both tools only read documentation — never mutate state and always return the same result for the
// same input — so spell out the hints rather than letting clients fall back to the conservative
// defaults (destructive, non-idempotent, open-world).
const readOnlyHints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

mcpServer.tool(
  {
    name: 'get_documentation_sections',
    description:
      'List every Mochi documentation section and demo. Returns a JSON array of { type, slug, title, description }. Call this first, then pass a { type, slug } to get_section to read one.',
    annotations: readOnlyHints,
  },
  async () => {
    const sections = await buildSectionIndex();
    logger.log('[mcp] get_documentation_sections →', sections.length, 'sections');
    return tool.text(JSON.stringify(sections));
  },
);

mcpServer.tool(
  {
    name: 'get_section',
    description:
      'Fetch the full text of one or more documentation sections (doc pages or demos). Pass an array of { type, slug } objects as returned by get_documentation_sections. Sections are returned in the requested order, each preceded by an ==== type:slug ==== marker.',
    annotations: readOnlyHints,
    schema: v.object({
      sections: v.array(v.object({ type: v.picklist(['doc', 'demo']), slug: v.string() })),
    }),
  },
  async ({ sections }) => {
    const results = await Promise.all(
      sections.map(async ({ type, slug }) => {
        const content = type === 'doc' ? await getDocLlmsTxt(slug) : await getDemoLlmsTxt(slug);
        return { type, slug, content };
      }),
    );

    const parts: string[] = [];
    const found: string[] = [];
    const missing: string[] = [];
    for (const { type, slug, content } of results) {
      const id = `${type}:${slug}`;
      parts.push(`==== ${id} ====\n\n${content !== null ? content.trimEnd() : '(not found)'}`);
      if (content !== null) {
        found.push(id);
      } else {
        missing.push(id);
      }
    }
    if (found.length) {
      logger.log(`[mcp] get_section [${found.join(', ')}] → ${found.length} found`);
    }
    if (missing.length) {
      logger.warn(`[mcp] get_section not found: ${missing.join(', ')}`);
    }
    if (!found.length) {
      return tool.error(`None of the requested sections were found. Call get_documentation_sections to list valid slugs.`);
    }
    return tool.text(parts.join('\n\n'));
  },
);

// A `trailingSlash:redirect` filter in index.ts exempts /mcp from the site's `trailingSlash: 'always'`
// policy so the endpoint answers at /mcp directly. The Mochi route already scopes this transport to
// that path, so let it respond regardless of pathname (`path: null`) — that also keeps the /mcp/ form
// working for clients that still send it. This server only answers request/response tool calls and
// pushes nothing back, so the long-lived SSE stream is disabled (GET returns 405).
const transport = new HttpTransport(mcpServer, { path: null, disableSse: true });

export async function respondMcp(request: Request): Promise<Response> {
  return (await transport.respond(request)) ?? new Response('Not Found', { status: 404 });
}
