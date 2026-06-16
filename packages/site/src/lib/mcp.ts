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
    description: 'Fetch the full text of one documentation section (a doc page or a demo) by its type and slug, as returned by get_documentation_sections.',
    annotations: readOnlyHints,
    schema: v.object({
      type: v.picklist(['doc', 'demo']),
      slug: v.string(),
    }),
  },
  async ({ type, slug }) => {
    const content = type === 'doc' ? await getDocLlmsTxt(slug) : await getDemoLlmsTxt(slug);
    if (content === null) {
      logger.warn(`[mcp] get_section ${type}:${slug} → not found`);
      return tool.error(`No ${type} found with slug '${slug}'. Call get_documentation_sections to list valid slugs.`);
    }
    logger.log(`[mcp] get_section ${type}:${slug} → ${content.length} chars`);
    return tool.text(content);
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
