import { expect, test } from 'bun:test';
import { routes } from './routes.ts';

test('/hn redirects to a relative location, not one built from the request Host or scheme', async () => {
  const handler = routes['/hn'] as (req: Request) => Response | Promise<Response>;
  const res = await handler(new Request('http://evil.tld/hn', { headers: { Host: 'evil.tld' } }));
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/hn/front/');
});
