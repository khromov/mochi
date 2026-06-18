import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// RFC 9727 API catalog as an RFC 9264 linkset. The profile parameter on the
// Content-Type tells RFC-aware clients this linkset is specifically an API catalog.
export const routes: Record<string, MochiRouteValue> = {
  '/.well-known/api-catalog': Mochi.api(async () => {
    const { url } = getRequestContext();
    const origin = url.origin;

    const body = {
      linkset: [
        {
          anchor: `${origin}/mcp`,
          'service-doc': [{ href: `${origin}/llms.txt`, type: 'text/plain' }],
          status: [{ href: `${origin}/health/`, type: 'application/json' }],
        },
      ],
    };

    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      },
    });
  }),
};
