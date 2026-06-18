import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };

// A2A AgentCard for the Mochi documentation assistant. The agent is read-only:
// it surfaces the same two MCP tools (get_documentation_sections / get_section)
// reachable over streamable HTTP at /mcp, so every URL is derived from the
// request origin rather than hardcoded.
export const routes: Record<string, MochiRouteValue> = {
  '/.well-known/agent-card.json': Mochi.api(async () => {
    const { url } = getRequestContext();
    const origin = url.origin;

    return Response.json({
      protocolVersion: '0.3',
      name: 'Mochi Docs Agent',
      description:
        'Official documentation and demos for the Mochi framework (SSR-first Svelte 5 on Bun with islands-based hydration). Lists and serves the full text of every Mochi doc section and demo.',
      version: mochiPkg.version,
      provider: {
        organization: 'Mochi',
        url: origin,
      },
      documentationUrl: origin,
      supportedInterfaces: [
        {
          url: `${origin}/mcp`,
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '0.3',
        },
      ],
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
      },
      defaultInputModes: ['application/json', 'text/plain'],
      defaultOutputModes: ['application/json', 'text/plain'],
      skills: [
        {
          id: 'get_documentation_sections',
          name: 'List documentation sections',
          description: 'List every Mochi documentation section and demo. Returns a JSON array of { type, slug, title, description }.',
          tags: ['documentation', 'mochi', 'discovery'],
          examples: ['What documentation sections does Mochi have?', 'List all Mochi demos.'],
        },
        {
          id: 'get_section',
          name: 'Fetch documentation section',
          description: 'Fetch the full text of one or more documentation sections (doc pages or demos) by { type, slug }.',
          tags: ['documentation', 'mochi', 'retrieval'],
          examples: ['Show me the Mochi forms documentation.', 'Read the cache demo source.'],
        },
      ],
    });
  }),
};
