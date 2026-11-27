import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { HttpTransport, type HttpTransportOptions } from '@tmcp/transport-http';
import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };
import { logger } from 'mochi-framework';
import { McpServer } from 'tmcp';
import { tool } from 'tmcp/utils';
import * as v from 'valibot';
import { buildSectionIndex, getDemoLlmsTxt, getDocLlmsTxt, getPostLlmsTxt } from './docs';

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
      'List every Mochi documentation section, demo, and blog post — including the changelog (a doc with slug "changelog", the record of what changed in each version). Returns a JSON array of { type, slug, title, description }. Call this first, then pass a { type, slug } to get_section to read one.',
    annotations: readOnlyHints,
  },
  async () => {
    const sections = await buildSectionIndex();
    logger.log('[mcp] get_documentation_sections →', sections.length, 'sections');
    return tool.text(JSON.stringify(sections));
  },
);

const MAX_SECTIONS = 50;
const MAX_SLUG_LENGTH = 100;
const MAX_LOGGED_MISSING = 5;

mcpServer.tool(
  {
    name: 'get_section',
    description:
      'Fetch the full text of one or more documentation sections (doc pages, demos, or blog posts). The changelog is available as { type: "doc", slug: "changelog" }. Pass an array of { type, slug } objects as returned by get_documentation_sections. Sections are returned in the requested order, each preceded by an ==== type:slug ==== marker; a section requested twice is returned once.',
    annotations: readOnlyHints,
    // tmcp echoes every validation issue back, each embedding the whole array, so stop at the first one.
    schema: v.config(
      v.object({
        sections: v.pipe(v.array(v.object({ type: v.picklist(['doc', 'demo', 'post']), slug: v.pipe(v.string(), v.maxLength(MAX_SLUG_LENGTH)) })), v.maxLength(MAX_SECTIONS)),
      }),
      { abortEarly: true },
    ),
  },
  async ({ sections }) => {
    // Repeating one large page would multiply the response for free, so each section is sent once.
    const unique = [...new Map(sections.map((s) => [`${s.type}:${s.slug}`, s])).values()];
    const results = await Promise.all(
      unique.map(async ({ type, slug }) => {
        const content = type === 'doc' ? await getDocLlmsTxt(slug) : type === 'post' ? await getPostLlmsTxt(slug) : await getDemoLlmsTxt(slug);
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
      // Missing ids carry the caller's raw slug, so JSON-encode them (plus the DEL/C1/U+2028 range JSON leaves raw) to keep CR/LF and escape codes out of the log.
      const shown = JSON.stringify(missing.slice(0, MAX_LOGGED_MISSING)).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      const more = missing.length > MAX_LOGGED_MISSING ? ` and ${missing.length - MAX_LOGGED_MISSING} more` : '';
      logger.warn(`[mcp] get_section not found: ${shown}${more}`);
    }
    if (!found.length) {
      return tool.error(`None of the requested sections were found. Call get_documentation_sections to list valid slugs.`);
    }
    return tool.text(parts.join('\n\n'));
  },
);

// Neither tool reads per-session client info, and the default in-memory store keeps every `initialize`
// payload forever under a client-chosen `mcp-session-id`.
const noSessionInfo: NonNullable<NonNullable<HttpTransportOptions['sessionManager']>['info']> = {
  getClientInfo: async () => undefined,
  setClientInfo: () => {},
  getClientCapabilities: async () => undefined,
  setClientCapabilities: () => {},
  getLogLevel: async () => undefined,
  setLogLevel: () => {},
  getSubscriptions: async () => [],
  addSubscription: () => {},
  delete: () => {},
};

// /mcp is a `Mochi.api()` route, so the site's `trailingSlash: 'always'` policy never applies to it and
// the endpoint answers at /mcp directly — some MCP clients don't follow a redirect to /mcp/.
const transport = new HttpTransport(mcpServer, { path: null, disableSse: true, sessionManager: { info: noSessionInfo } });

// A full get_section call is about 7 KB, and a validation error echoes its input about 14 times, so this also bounds the reply.
export const MAX_MCP_BODY_BYTES = 32 * 1024;

async function readBodyCapped(request: Request, limit: number): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get('content-length')) > limit) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > limit) {
        return null;
      }
      chunks.push(chunk);
    }
  }
  return Bun.concatArrayBuffers(chunks);
}

export async function respondMcp(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    const body = await readBodyCapped(request, MAX_MCP_BODY_BYTES);
    if (body === null) {
      return new Response('Payload Too Large', { status: 413 });
    }
    request = new Request(request, { body });
  }
  return (await transport.respond(request)) ?? new Response('Not Found', { status: 404 });
}
