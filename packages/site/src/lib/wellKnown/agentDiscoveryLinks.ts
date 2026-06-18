import type { Handle } from 'mochi-framework';

// RFC 8288 Link headers point agents from the homepage to the machine-readable
// discovery surfaces (API catalog + human docs). Only on '/' so it doesn't
// pollute every asset/API response.
export const AGENT_DISCOVERY_LINK = '</.well-known/api-catalog>; rel="api-catalog", </llms.txt>; rel="service-doc"';

export const agentDiscoveryLinks: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.pathname === '/') {
    response.headers.append('Link', AGENT_DISCOVERY_LINK);
  }
  return response;
};
