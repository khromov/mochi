import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };

// SEP-1649 MCP Server Card: a discovery document agents fetch before connecting,
// so they learn the server's identity, transport endpoint, and capabilities
// without a live handshake. Mirrors the values declared on mcpServer in ./mcp.ts.
export const routes: Record<string, MochiRouteValue> = {
  '/.well-known/mcp/server-card.json': Mochi.api(async () => {
    const { url } = getRequestContext();

    const body = {
      serverInfo: {
        name: 'mochi-docs',
        version: `${mochiPkg.version}`,
        description:
          'Official documentation and demos for the Mochi framework (SSR-first Svelte 5 on Bun with islands-based hydration). Consult get_documentation_sections, then get_section, before writing or changing Mochi code.',
      },
      // Endpoint is derived from the request origin so the card stays correct
      // across localhost, preview, and production without hardcoding a domain.
      transport: {
        type: 'streamable-http',
        endpoint: `${url.origin}/mcp`,
      },
      capabilities: {
        tools: { listChanged: false },
      },
    };

    return Response.json(body);
  }),
};
