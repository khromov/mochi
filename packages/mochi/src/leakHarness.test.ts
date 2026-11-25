import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { startLoad } from './loadGen';
import { STATIC_ROUTES, type RouteHit } from './routes';

describe('leak harness load generator', () => {
  let server: Server<undefined>;
  let baseUrl: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        '/ok': new Response('ok'),
        '/moved': new Response(null, { status: 301, headers: { Location: '/ok' } }),
        '/boom': new Response('boom', { status: 500 }),
        '/gone': new Response('gone', { status: 404 }),
        '/form': (req) => new Response(null, req.headers.get('origin') === baseUrl ? { status: 303, headers: { Location: '/ok' } } : { status: 403 }),
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  async function load(routes: RouteHit[]) {
    return startLoad({ baseUrl, routes, rps: 200, durationMs: 300, concurrency: 1 });
  }

  test('counts HTTP responses other than the expected status as errors', async () => {
    const stats = await load([
      { name: 'moved', method: 'GET', path: '/moved', weight: 1 },
      { name: 'boom', method: 'GET', path: '/boom', weight: 1 },
    ]);
    expect(stats.totalErrors).toBeGreaterThan(0);
    expect(stats.totalRequests).toBe(0);
  });

  test('an expected non-200 status is not an error', async () => {
    const stats = await load([
      { name: 'ok', method: 'GET', path: '/ok', weight: 1 },
      { name: 'gone', method: 'GET', path: '/gone', weight: 1, expectStatus: 404 },
    ]);
    expect(stats.totalErrors).toBe(0);
    expect(stats.totalRequests).toBeGreaterThan(0);
  });

  test('POSTs carry an Origin header so CSRF-protected form actions run', async () => {
    const stats = await load([{ name: 'form', method: 'POST', path: '/form', weight: 1, expectStatus: 303 }]);
    expect(stats.totalErrors).toBe(0);
    expect(stats.byRoute.get('form')?.status3xx).toBeGreaterThan(0);
  });
});

test('page fixtures use the trailing-slash form the site serves', () => {
  const pages = STATIC_ROUTES.filter((r) => r.name.startsWith('page:') || r.name.startsWith('form:'));
  expect(pages.length).toBeGreaterThan(0);
  for (const r of pages) {
    expect(r.path).toEndWith('/');
  }
});
